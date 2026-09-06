"""Magic-point economy (Chapter 10). Ported from coc_mp.py.

Snapshot: `<campaign>/save/mp-state/<investigator>.json` (`mp`, `mp_max`, `current_hp`).
The settlement layer mirrors `mp` into the party sheet's `current_mp`."""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from ..fileio import read_json, write_json_atomic
from .tables import RuleTables

_DEFAULT_ECONOMY = {
    "initial": "POW/5 floor",
    "regen_per_hour": 1,
    "regen_per_hour_pow_above_100": 2,
    "after_zero_costs_hp_one_for_one": True,
    "max_cannot_exceed_pow_divided_5": True,
}


def mp_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / "save" / "mp-state" / f"{investigator_id}.json"


def read_mp_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = mp_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    data = read_json(path)
    return data if isinstance(data, dict) else {}


class MPool:
    """Structured MP pool for one investigator; overspill below 0 costs HP 1:1."""

    def __init__(self, investigator_id: str, pow_value: int, rng: random.Random | None = None, *,
                 mp_economy: dict[str, Any] | None = None, current_hp: int | None = None) -> None:
        self.investigator_id = investigator_id
        self.pow_value = int(pow_value)
        self._rng = rng or random.Random()
        self._mp_economy = mp_economy or dict(_DEFAULT_ECONOMY)
        self.mp_max = self.pow_value // 5
        self.current_mp = self.mp_max
        self.current_hp = current_hp
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0

    @property
    def regen_per_hour(self) -> int:
        base = int(self._mp_economy.get("regen_per_hour", 1))
        if self.pow_value > 100:
            return int(self._mp_economy.get("regen_per_hour_pow_above_100", base * 2))
        return base

    def can_spend(self, amount: int) -> bool:
        if amount <= self.current_mp:
            return True
        overspill = amount - self.current_mp
        if self.current_hp is None:
            return True
        return (self.current_hp - overspill) > 0

    def spend_mp(self, amount: int, *, source: str = "cast") -> dict[str, Any]:
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
        return self._event("mp_spend", {
            "source": source, "amount": amount, "mp_before": mp_before, "mp_after": self.current_mp,
            "overspill_to_hp": overspill, "hp_damage": hp_damage, "hp_before": hp_before, "hp_after": self.current_hp,
            "summary": (f"{self.investigator_id} spent {amount} MP ({mp_before}->{self.current_mp})"
                        + (f", overspill {overspill} -> HP damage" if overspill else "") + f" ({source})."),
        })

    def regen_mp(self, hours: float, *, source: str = "rest") -> int:
        if hours <= 0:
            return 0
        gain = int(round(self.regen_per_hour * hours))
        if gain < 1:
            gain = 1
        mp_before = self.current_mp
        new_mp = self.current_mp + gain
        if self._mp_economy.get("max_cannot_exceed_pow_divided_5", True):
            new_mp = min(new_mp, self.mp_max)
        actual_gain = new_mp - mp_before
        if actual_gain <= 0:
            return 0
        self.current_mp = new_mp
        self._event("mp_regen", {"source": source, "hours": hours, "gain_per_hour": self.regen_per_hour,
                                 "gain": actual_gain, "mp_before": mp_before, "mp_after": self.current_mp,
                                 "summary": f"{self.investigator_id} regenerated {actual_gain} MP over {hours}h rest ({source})."})
        return actual_gain

    def snapshot(self) -> dict[str, Any]:
        return {"investigator_id": self.investigator_id, "pow_value": self.pow_value, "mp_max": self.mp_max,
                "mp": self.current_mp, "current_hp": self.current_hp, "events": list(self.events)}

    def save(self, campaign_dir: Path) -> Path:
        data = read_mp_state(campaign_dir, self.investigator_id)
        data.update({"investigator_id": self.investigator_id, "mp": self.current_mp, "mp_max": self.mp_max})
        if self.current_hp is not None:
            data["current_hp"] = self.current_hp
        path = mp_state_path(campaign_dir, self.investigator_id)
        write_json_atomic(path, data)
        return path

    @classmethod
    def load(cls, tables: RuleTables, campaign_dir: Path, investigator_id: str, pow_value: int,
             rng: random.Random | None = None, *, current_mp: int | None = None,
             current_hp: int | None = None) -> "MPool":
        """Snapshot first; the sheet's `current_mp` / `current_hp` win when given."""
        pool = cls(investigator_id, pow_value, rng, mp_economy=tables.magic_mp_economy() or dict(_DEFAULT_ECONOMY))
        data = read_mp_state(campaign_dir, investigator_id)
        if "mp" in data:
            pool.current_mp = int(data["mp"])
        if "mp_max" in data:
            pool.mp_max = int(data["mp_max"])
        if "current_hp" in data:
            pool.current_hp = int(data["current_hp"])
        if current_mp is not None:
            pool.current_mp = int(current_mp)
        if current_hp is not None:
            pool.current_hp = int(current_hp)
        return pool

    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"mp{self._event_counter}", **payload}
        self.events.append(ev)
        return ev


def handle_time_trigger(tables: RuleTables, campaign_dir: Path, investigator_id: str, pow_value: int,
                        delta_minutes: int, *, source: str = "downtime", rng: random.Random | None = None,
                        current_mp: int | None = None) -> int:
    """MP regeneration for a downtime advance; returns the MP gained."""
    if delta_minutes <= 0:
        return 0
    pool = MPool.load(tables, campaign_dir, investigator_id, pow_value, rng, current_mp=current_mp)
    gained = pool.regen_mp(delta_minutes / 60.0, source=source)
    pool.save(campaign_dir)
    return gained
