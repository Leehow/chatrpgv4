#!/usr/bin/env python3
"""Magic-points (MP) economy for Call of Cthulhu 7e — Chapter 10 (Magick).

Owns the structured MP pool for one investigator across a session, parallel
to SanitySession for SAN and CombatSession for HP. Produces structured MP
events (spend / regen / overspill) and a snapshot persisted alongside the
investigator-state record.

Rulebook basis (Chapter 10, 7e 40th Anniversary):
- MP pool starts at POW / 5 (rounded down) (p.137 / mp_economy.initial)
- Regenerates 1 MP per hour, or 2 MP per hour if POW > 100
  (mp_economy.regen_per_hour[_pow_above_100])
- When casting drives MP below 0, the excess is taken as HP damage 1-for-1
  (mp_economy.after_zero_costs_hp_one_for_one, p.137)
- MP can never regenerate above POW / 5 (mp_economy.max_cannot_exceed_pow_divided_5)

Files managed:
  save/investigator-state/<id>.json  — `mp` and `mp_max` fields (merged)
  logs/events.jsonl                  — mp events appended here (shared)
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


coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_rulesets = _load_sibling("coc_rulesets", "coc_rulesets.py")


# --------------------------------------------------------------------------- #
# Rule-data loading (spells.json -> mp_economy block)
# --------------------------------------------------------------------------- #
RULES_DIR = coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)


def _load_mp_economy(rules_dir: Path | None = None) -> dict[str, Any]:
    """Load the mp_economy block from spells.json.

    Returns defaults if the file/section is missing so the module degrades
    gracefully when rule data is incomplete.
    """
    rdir = rules_dir or RULES_DIR
    path = rdir / "spells.json"
    if not path.exists():
        return {
            "initial": "POW/5 floor",
            "regen_per_hour": 1,
            "regen_per_hour_pow_above_100": 2,
            "after_zero_costs_hp_one_for_one": True,
            "max_cannot_exceed_pow_divided_5": True,
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("mp_economy", {
        "initial": "POW/5 floor",
        "regen_per_hour": 1,
        "regen_per_hour_pow_above_100": 2,
        "after_zero_costs_hp_one_for_one": True,
        "max_cannot_exceed_pow_divided_5": True,
    })


# --------------------------------------------------------------------------- #
# Investigator-state read/write (merge mp/mp_max into the existing record)
# --------------------------------------------------------------------------- #
def _inv_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"


def _read_inv_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = _inv_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_inv_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> None:
    path = _inv_state_path(campaign_dir, investigator_id)
    coc_fileio.write_json_atomic(
        path, data, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _append_event(campaign_dir: Path, event: dict[str, Any]) -> None:
    """Append an MP event to logs/events.jsonl."""
    path = campaign_dir / "logs" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# MPool session
# --------------------------------------------------------------------------- #
class MPool:
    """Structured MP pool for one investigator across a session.

    Tracks current/max MP, spend and regeneration, and HP overspill when MP
    is driven below zero. Persists `mp`/`mp_max` into the investigator-state
    record and emits structured events.

    The session is deterministic given the RNG it is handed.
    """

    def __init__(
        self,
        investigator_id: str,
        pow_value: int,
        rng: random.Random | None = None,
        *,
        mp_economy: dict[str, Any] | None = None,
        current_hp: int | None = None,
    ) -> None:
        self.investigator_id = investigator_id
        self.pow_value = int(pow_value)
        self._rng = rng or random.Random()
        self._mp_economy = mp_economy or _load_mp_economy()
        # mp_max = POW // 5 (floor), per mp_economy.initial "POW/5 floor"
        self.mp_max = self.pow_value // 5
        self.current_mp = self.mp_max
        # HP tracking for overspill; optional — when None, overspill is
        # recorded but not applied to an HP counter (caller resolves HP).
        self.current_hp = current_hp
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0

    # ------------------------------------------------------------------ #
    # Core operations
    # ------------------------------------------------------------------ #
    @property
    def regen_per_hour(self) -> int:
        """MP regenerated per hour of rest (2/hr if POW > 100, else 1/hr)."""
        base = int(self._mp_economy.get("regen_per_hour", 1))
        if self.pow_value > 100:
            return int(self._mp_economy.get("regen_per_hour_pow_above_100", base * 2))
        return base

    def can_spend(self, amount: int) -> bool:
        """True if the investigator can pay `amount` MP without overspill.

        Overspill (HP damage) is *allowed* by the rules — a caster may push
        past 0 — so this returns False only when the cost cannot be paid even
        with full HP, i.e. when HP would go negative from the overspill.
        """
        if amount <= self.current_mp:
            return True
        # Would overspill into HP
        overspill = amount - self.current_mp
        if self.current_hp is None:
            return True  # caller resolves HP separately
        return (self.current_hp - overspill) > 0

    def spend_mp(self, amount: int, *, source: str = "cast") -> dict[str, Any]:
        """Spend `amount` MP. Allows going below 0 (overspill → HP 1:1).

        Returns the event record. When MP goes negative, the deficit is
        applied as HP damage and the event records `hp_damage`.
        """
        amount = int(amount)
        mp_before = self.current_mp
        hp_before = self.current_hp

        new_mp = self.current_mp - amount
        hp_damage = 0
        overspill = 0
        if new_mp < 0 and self._mp_economy.get("after_zero_costs_hp_one_for_one", True):
            overspill = -new_mp
            new_mp = 0
            if self.current_hp is not None:
                hp_damage = overspill
                self.current_hp = max(0, self.current_hp - hp_damage)

        self.current_mp = new_mp
        event = self._event("mp_spend", {
            "source": source,
            "amount": amount,
            "mp_before": mp_before,
            "mp_after": self.current_mp,
            "overspill_to_hp": overspill,
            "hp_damage": hp_damage,
            "hp_before": hp_before,
            "hp_after": self.current_hp,
            "summary": (
                f"{self.investigator_id} spent {amount} MP ({mp_before}->{self.current_mp})"
                + (f", overspill {overspill} -> HP damage" if overspill else "")
                + f" ({source})."
            ),
        })
        return event

    def regen_mp(self, hours: float, *, source: str = "rest") -> int:
        """Regenerate MP for `hours` of rest. Returns the MP gained.

        Regenerates `regen_per_hour` MP per hour (2/hr if POW > 100),
        capped at mp_max. Fractional hours are honored (pro-rated).
        """
        if hours <= 0:
            return 0
        gain_per_hour = self.regen_per_hour
        # Pro-rate fractional hours, then round to nearest MP.
        raw_gain = gain_per_hour * hours
        gain = int(round(raw_gain))
        if gain < 1 and hours > 0:
            gain = 1  # any rest gives at least a chance; min 1 if >0 hours
        cap_at_max = self._mp_economy.get("max_cannot_exceed_pow_divided_5", True)
        mp_before = self.current_mp
        new_mp = self.current_mp + gain
        if cap_at_max:
            new_mp = min(new_mp, self.mp_max)
        actual_gain = new_mp - mp_before
        if actual_gain <= 0:
            return 0  # already at cap
        self.current_mp = new_mp
        self._event("mp_regen", {
            "source": source,
            "hours": hours,
            "gain_per_hour": gain_per_hour,
            "gain": actual_gain,
            "mp_before": mp_before,
            "mp_after": self.current_mp,
            "summary": f"{self.investigator_id} regenerated {actual_gain} MP over {hours}h rest ({source}).",
        })
        return actual_gain

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "investigator_id": self.investigator_id,
            "pow_value": self.pow_value,
            "mp_max": self.mp_max,
            "mp": self.current_mp,
            "current_hp": self.current_hp,
            "events": list(self.events),
        }

    def save(self, campaign_dir: Path) -> Path:
        """Merge `mp` and `mp_max` into save/investigator-state/<id>.json.

        Also persists `current_hp` if tracked. Returns the path written.
        """
        data = _read_inv_state(campaign_dir, self.investigator_id)
        data["mp"] = self.current_mp
        data["mp_max"] = self.mp_max
        if self.current_hp is not None:
            data["current_hp"] = self.current_hp
        _write_inv_state(campaign_dir, self.investigator_id, data)
        return _inv_state_path(campaign_dir, self.investigator_id)

    def persist_events(self, campaign_dir: Path) -> None:
        """Append accumulated MP events to logs/events.jsonl."""
        for ev in self.events:
            _append_event(campaign_dir, ev)

    @classmethod
    def load(cls, campaign_dir: Path, investigator_id: str,
             pow_value: int, rng: random.Random | None = None) -> "MPool":
        """Reconstruct an MPool from saved investigator-state, if present."""
        pool = cls(investigator_id, pow_value, rng)
        data = _read_inv_state(campaign_dir, investigator_id)
        if "mp" in data:
            pool.current_mp = int(data["mp"])
        if "mp_max" in data:
            pool.mp_max = int(data["mp_max"])
        if "current_hp" in data:
            pool.current_hp = int(data["current_hp"])
        return pool

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"mp{self._event_counter}", **payload}
        self.events.append(ev)
        return ev


# --------------------------------------------------------------------------- #
# coc_time integration: regen on downtime/sleep triggers
# --------------------------------------------------------------------------- #
def handle_time_trigger(
    campaign_dir: Path,
    investigator_id: str,
    pow_value: int,
    delta_minutes: int,
    *,
    source: str = "downtime",
    rng: random.Random | None = None,
) -> int:
    """Apply MP regeneration for a time advance (downtime/sleep).

    Called by the time layer when a downtime/sleep_night category advance
    fires. Converts delta_minutes to hours and regenerates MP, persisting
    the result. Returns the MP gained.
    """
    if delta_minutes <= 0:
        return 0
    hours = delta_minutes / 60.0
    pool = MPool.load(campaign_dir, investigator_id, pow_value, rng)
    gained = pool.regen_mp(hours, source=source)
    pool.save(campaign_dir)
    pool.persist_events(campaign_dir)
    return gained
