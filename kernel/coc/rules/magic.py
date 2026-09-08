"""Spell casting and learning (Chapter 9). Ported from coc_magic.py plus the spell-name
resolution that lived in coc_rules.py.

The old engine scheduled tome/person study completion through coc_time; the kernel
has one world clock (`world.clock.minutes`), so `learn_spell` reports the due
minute and the settlement layer records the study in `save/magic-state/<inv>.json`.
A studying spell whose due minute has passed counts as learned (see `known_spells`)."""

from __future__ import annotations

import random
import re
from pathlib import Path
from typing import Any

from ..fileio import read_json, write_json_atomic
from . import percentile
from .catalog import Catalog, demoted_module_block, module_record_named
from .tables import RuleTables

_DICE_RE = re.compile(r"^(\d+)D(\d+)([+-]\d+)?$")


class UnpricedSpellError(ValueError):
    """A module-authored spell nobody priced; refused rather than cast for free."""

    def __init__(self, spell: str, node_id: str, missing: list[str]) -> None:
        self.spell = spell
        self.node_id = node_id
        self.missing = list(missing)
        super().__init__(
            f"{spell!r} is authored by the module as {node_id} without " + " and ".join(self.missing)
            + "; casting cannot be priced from it. Author the missing cost field(s) on the node, or adjudicate "
            "the cast outside the magic runtime -- a missing cost is not a zero cost.")


# ---- spell names: rulebook rows, parameterised families, module nodes ----------------

def _module_spell_entry(record: dict[str, Any], module_authored: dict[str, Any]) -> dict[str, Any]:
    costs = module_authored.get("costs") if isinstance(module_authored.get("costs"), dict) else {}
    entry: dict[str, Any] = {
        "name": str(record.get("name") or ""), "description": str(module_authored.get("summary") or ""),
        "module_node_id": str(module_authored.get("node_id") or ""),
        "module_id": str(module_authored.get("module_id") or ""),
        "costs_authored": bool(costs.get("authored")), "unpriced_fields": list(costs.get("missing") or []),
    }
    fields = costs.get("fields") if isinstance(costs.get("fields"), dict) else {}
    entry.update(fields)
    return entry


def resolve_spell_name(tables: RuleTables, catalog: Catalog, name: str, *,
                       module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """`{canonical_name, entry, parameterisation, module_authored}`; KeyError when unknown.
    The rulebook table wins a shared name; a module node of that name is an annotation."""
    if not isinstance(name, str) or not name.strip():
        raise KeyError(f"unknown spell: {name!r}")
    name = name.strip()
    for spell in tables.spells_table().get("spells", []):
        if isinstance(spell, dict) and str(spell.get("name") or "").lower() == name.lower():
            record = module_record_named(module_spells, name) if module_spells else None
            return {"canonical_name": str(spell["name"]), "entry": spell, "parameterisation": None,
                    "module_authored": demoted_module_block(record) if record else None}
    for record in module_spells or []:
        definition = record.get("generated_definition")
        if isinstance(definition, dict) and definition["name"].casefold() == name.casefold():
            return {"canonical_name": definition["name"], "entry": {**definition["parameters"],
                    "name": definition["name"], "description": definition["description"],
                    "generated_definition": definition}, "parameterisation": None, "module_authored": None}
    resolved = catalog.resolve_name("spell", name, module_spells=module_spells)
    parameterisation = (resolved or {}).get("parameterisation")
    if parameterisation:
        family_name = str(parameterisation.get("family_name") or "")
        for spell in tables.spells_table().get("spells", []):
            if isinstance(spell, dict) and str(spell.get("name") or "") == family_name:
                return {"canonical_name": str(resolved["canonical_name"]), "entry": spell,
                        "parameterisation": dict(parameterisation), "module_authored": None}
    module_authored = (resolved or {}).get("module_authored")
    if isinstance(module_authored, dict) and module_authored.get("authority") == "module_authored_spell":
        return {"canonical_name": str(resolved["canonical_name"]),
                "entry": _module_spell_entry(resolved["record"], module_authored),
                "parameterisation": None, "module_authored": module_authored}
    raise KeyError(f"unknown spell: {name!r}")


def canonical_spell_name(tables: RuleTables, catalog: Catalog, name: str, *,
                         module_spells: list[dict[str, Any]] | None = None) -> str:
    try:
        return resolve_spell_name(tables, catalog, name, module_spells=module_spells)["canonical_name"]
    except KeyError:
        return name.strip() if isinstance(name, str) else ""


def spell_by_name(tables: RuleTables, catalog: Catalog, name: str, *,
                  module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return resolve_spell_name(tables, catalog, name, module_spells=module_spells)["entry"]


# ---- rule data ----------------------------------------------------------------------

def casting_rules(tables: RuleTables) -> dict[str, Any]:
    return tables.magic_casting_rules() or {
        "first_cast_roll": "Hard POW", "pushable": True, "push_mp_multiplier": "1D6",
        "mp_overspill_to_hp_one_for_one": True, "subsequent_casts_no_roll": True, "npcs_no_casting_roll": True,
        "failed_pushed_cast_works": True, "disrupted_cast_pays_mp_and_sanity": True,
    }


def learning_rules(tables: RuleTables) -> dict[str, Any]:
    return tables.magic_learning_rules() or {
        "roll": "Hard INT", "pushable": True, "from_tome_weeks": "2D6", "from_person_days": "1D8",
        "from_entity_min_sanity_cost": "1D6", "from_entity_roll": "Regular INT",
    }


def push_side_effect_tables(tables: RuleTables) -> dict[str, list[dict[str, Any]]]:
    table = tables.spells_table().get("push_side_effects") or {}
    return {"minor": list(table.get("minor") or []), "major": list(table.get("major") or [])}


def _roll_dice(expr: str, rng: random.Random) -> int:
    m = _DICE_RE.match(str(expr).strip())
    if m:
        n, sides = int(m.group(1)), int(m.group(2))
        mod = int(m.group(3)) if m.group(3) else 0
        return sum(rng.randint(1, sides) for _ in range(n)) + mod
    try:
        return int(expr)
    except (TypeError, ValueError):
        try:
            return int(percentile.roll_expression(str(expr), rng)["total"])
        except ValueError:
            return 0  # Preserve legacy variable-cost handling outside validated definitions.


def _resolve_mp_cost(cost_expr: str | int | None, rng: random.Random) -> int:
    if cost_expr is None:
        return 0
    if isinstance(cost_expr, int):
        return cost_expr
    text = str(cost_expr).strip()
    if text.endswith("+"):
        try:
            return int(text[:-1])
        except ValueError:
            return 0
    if "per person" in text or "per/person" in text:
        return 1
    if text.lower() in ("variable",):
        return 0
    leading = re.match(r"^(\d+)\b", text)
    if leading and not _DICE_RE.match(text):
        try:
            return int(leading.group(1))
        except ValueError:
            return 0
    return _roll_dice(text, rng)


def _resolve_sanity_cost(cost_expr: str | int | None, rng: random.Random) -> int:
    if cost_expr is None:
        return 0
    if isinstance(cost_expr, int):
        return cost_expr
    text = str(cost_expr).strip()
    if text.lower() in ("variable", ""):
        return 0
    return _roll_dice(text, rng)


def _resolve_pow_cost(spell: dict[str, Any], rng: random.Random) -> int:
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
    for key in ("push_tier", "power_tier", "side_effect_tier"):
        raw = spell.get(key)
        if isinstance(raw, str) and raw.strip().lower() in ("minor", "major"):
            return raw.strip().lower()
    return "major" if base_mp >= 10 else "minor"


def _roll_push_side_effect(tables: RuleTables, tier: str, rng: random.Random) -> dict[str, Any]:
    side_tables = push_side_effect_tables(tables)
    entries = side_tables.get(tier) or side_tables.get("minor") or []
    roll = rng.randint(1, 8)
    effect = ""
    for entry in entries:
        if int(entry.get("roll", 0)) == roll:
            effect = str(entry.get("effect", ""))
            break
    if not effect and entries:
        effect = str(entries[min(roll, len(entries)) - 1].get("effect", ""))
    return {"roll": roll, "tier": tier, "effect": effect}


def _spend_mp(mp_spent: int, *, spell_name: str, caster_state: dict[str, Any], casting: dict[str, Any],
              mp_pool: Any | None) -> int:
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
        hp_damage = -new_mp
        new_mp = 0
        caster_state["current_hp"] = max(0, current_hp - hp_damage)
    caster_state["current_mp"] = new_mp
    return hp_damage


def _apply_san_loss(caster_state: dict[str, Any], san_lost: int) -> None:
    if san_lost > 0 and "current_san" in caster_state:
        caster_state["current_san"] = max(0, int(caster_state.get("current_san", 0)) - san_lost)


def _apply_pow_cost(caster_state: dict[str, Any], pow_spent: int) -> None:
    if pow_spent > 0 and "pow" in caster_state:
        caster_state["pow"] = max(0, int(caster_state.get("pow", 0)) - pow_spent)


# ---- cast / learn -------------------------------------------------------------------

def cast_spell(tables: RuleTables, catalog: Catalog, spell_name: str, caster_state: dict[str, Any], *,
               is_first_cast: bool, is_npc: bool = False, pushed: bool = False, interrupted: bool = False,
               rng: random.Random | None = None, mp_pool: Any | None = None,
               module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Resolve casting per pp.177-179. `caster_state` needs `pow`; MP/HP/SAN are
    adjusted through `mp_pool` when given, else inline on the state."""
    rng = rng or random.Random()
    casting = casting_rules(tables)
    spell = spell_by_name(tables, catalog, spell_name, module_spells=module_spells)
    if spell.get("costs_authored") is False:
        raise UnpricedSpellError(spell_name, str(spell.get("module_node_id") or ""),
                                 [str(f) for f in spell.get("unpriced_fields") or []])
    mp_cost_expr = spell.get("cost_mp", "0")
    san_cost_expr = spell.get("cost_sanity", "0")

    if interrupted:
        base_mp = _resolve_mp_cost(mp_cost_expr, rng)
        hp_damage = _spend_mp(base_mp, spell_name=spell_name, caster_state=caster_state, casting=casting, mp_pool=mp_pool)
        san_lost = _resolve_sanity_cost(san_cost_expr, rng)
        _apply_san_loss(caster_state, san_lost)
        return {"spell": spell_name, "success": False, "pushed": pushed, "interrupted": True, "is_npc": is_npc,
                "is_first_cast": is_first_cast, "roll_result": None, "mp_spent": base_mp, "hp_damage": hp_damage,
                "san_lost": san_lost, "pow_spent": 0, "base_mp_cost": base_mp, "side_effect": None,
                "summary": f"cast {spell_name}: interrupted, mp {base_mp} lost, success=False"}

    needs_roll = False
    roll_result: dict[str, Any] | None = None
    success = True
    if is_npc and casting.get("npcs_no_casting_roll", True):
        needs_roll = False
    elif is_first_cast or pushed:
        needs_roll = True
    if needs_roll:
        pow_value = int(caster_state.get("pow", 0))
        roll_result = percentile.percentile_check(tables, pow_value, difficulty="hard", rng=rng)
        success = roll_result.get("outcome") in percentile.SUCCESS_OUTCOMES

    base_mp = _resolve_mp_cost(mp_cost_expr, rng)
    mp_spent = base_mp
    push_multiplier = 1
    pushed_failed = pushed and not success
    if pushed_failed:
        push_multiplier = max(1, _roll_dice(str(casting.get("push_mp_multiplier", "1D6")), rng))
        mp_spent = base_mp * push_multiplier
    hp_damage = _spend_mp(mp_spent, spell_name=spell_name, caster_state=caster_state, casting=casting, mp_pool=mp_pool)

    san_lost = 0
    pow_spent = 0
    side_effect: dict[str, Any] | None = None
    if success or pushed_failed:
        san_lost = _resolve_sanity_cost(san_cost_expr, rng) * push_multiplier
        _apply_san_loss(caster_state, san_lost)
        pow_spent = _resolve_pow_cost(spell, rng) * push_multiplier
        _apply_pow_cost(caster_state, pow_spent)
    if pushed_failed:
        side_effect = _roll_push_side_effect(tables, _push_tier_for_spell(spell, base_mp), rng)
        success = True
    return {
        "spell": spell_name, "success": success, "pushed": pushed, "interrupted": False, "is_npc": is_npc,
        "is_first_cast": is_first_cast, "roll_result": roll_result, "mp_spent": mp_spent, "hp_damage": hp_damage,
        "san_lost": san_lost, "pow_spent": pow_spent, "base_mp_cost": base_mp, "side_effect": side_effect,
        "summary": (f"cast {spell_name}: "
                    + ("auto-success" if roll_result is None else f"POW(hard)->{roll_result.get('outcome')}")
                    + (", pushed" if pushed else "") + f", mp {mp_spent} (hp {hp_damage}), san -{san_lost}"
                    + (f", pow -{pow_spent}" if pow_spent else "") + f", success={success}"),
    }


def learn_spell(tables: RuleTables, catalog: Catalog, spell_name: str, learner_state: dict[str, Any],
                source: str = "tome", *, rng: random.Random | None = None, clock_minutes: int | None = None,
                module_spells: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Resolve learning per pp.176-177: Hard INT (entity: Regular INT); a tome takes
    2D6 weeks, a person 1D8 days, an entity impresses the spell at once."""
    rng = rng or random.Random()
    learning = learning_rules(tables)
    if source not in ("tome", "person", "entity"):
        raise ValueError(f"unsupported learn source: {source!r}")
    spell = spell_by_name(tables, catalog, spell_name, module_spells=module_spells)
    int_value = int(learner_state.get("int", 0))
    difficulty = "regular" if source == "entity" else "hard"
    roll_result = percentile.percentile_check(tables, int_value, difficulty=difficulty, rng=rng)
    outcome = roll_result.get("outcome")
    learned = outcome in percentile.SUCCESS_OUTCOMES
    study_weeks = 0
    study_days = 0
    completion_elapsed_minutes: int | None = None
    san_cost_expr: str | None = None
    if source == "entity":
        san_cost_expr = str(spell.get("from_entity_min_sanity_cost") or learning.get("from_entity_min_sanity_cost") or "1D6")
    if learned:
        if source == "tome":
            study_weeks = _roll_dice(str(learning.get("from_tome_weeks", "2D6")), rng)
            study_days = study_weeks * 7
        elif source == "person":
            study_days = _roll_dice(str(learning.get("from_person_days", "1D8")), rng)
        if source in ("tome", "person") and clock_minutes is not None:
            completion_elapsed_minutes = int(clock_minutes) + study_days * 24 * 60
    result: dict[str, Any] = {
        "spell": spell_name, "source": source, "learned": learned, "roll_result": roll_result,
        "study_weeks": study_weeks, "study_days": study_days,
        "study_completion_elapsed_minutes": completion_elapsed_minutes,
        "summary": (f"learn {spell_name} from {source}: INT({difficulty})->{outcome}, "
                    + ("learned" if learned else "not learned")
                    + (f", {study_weeks}w study" if source == "tome" and learned
                       else (f", {study_days}d study" if learned and source == "person" else ""))
                    + (f", san floor {san_cost_expr}" if san_cost_expr else "")),
    }
    if san_cost_expr is not None:
        result["san_cost_expr"] = san_cost_expr
    return result


# ---- per-investigator magic state ---------------------------------------------------

def magic_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / "save" / "magic-state" / f"{investigator_id}.json"


def read_magic_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = magic_state_path(campaign_dir, investigator_id)
    data = read_json(path) if path.exists() else {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("investigator_id", investigator_id)
    for key in ("learned_spells", "cast_spells", "studying_spells"):
        if not isinstance(data.get(key), list):
            data[key] = []
    return data


def write_magic_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> Path:
    path = magic_state_path(campaign_dir, investigator_id)
    write_json_atomic(path, data)
    return path


def known_spells(state: dict[str, Any], clock_minutes: int) -> list[str]:
    """Learned spells plus studies whose due minute the world clock has passed."""
    known = [str(v) for v in state.get("learned_spells") or []]
    for row in state.get("studying_spells") or []:
        if not isinstance(row, dict):
            continue
        due = row.get("due_elapsed_minutes")
        if isinstance(due, int) and not isinstance(due, bool) and due <= int(clock_minutes):
            name = str(row.get("spell") or "")
            if name and name not in known:
                known.append(name)
    return known
