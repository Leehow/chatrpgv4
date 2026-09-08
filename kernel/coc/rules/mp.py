"""Magic-point economy (Chapter 10). Ported from coc_mp.py.

Snapshot: `<campaign>/save/mp-state/<investigator>.json` (`mp`, `mp_max`, `current_hp`,
`regen_remainder_minutes`). The settlement layer mirrors `mp` into the party sheet's
`current_mp`; `regen_remainder_minutes` is internal regen bookkeeping and is never
mirrored anywhere else (see `regen_mp` below)."""

from __future__ import annotations

import copy
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

#: #78: what this engine writes under `save/`, as paths relative to the campaign directory.
#: The worldline reads this to know whose file it is looking at when a time loop rewinds
#: the clock under a kept investigator (`rebase_clock` below); `mp_state_path` builds on it
#: so the declaration and the writer cannot drift apart.
SAVE_DIR = "save/mp-state"
SAVE_PATHS = (SAVE_DIR,)


def mp_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / SAVE_DIR / f"{investigator_id}.json"


def read_mp_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = mp_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    data = read_json(path)
    return data if isinstance(data, dict) else {}


def rebase_clock(state: dict[str, Any], delta: int) -> dict[str, Any]:
    """#78: this engine's saved state with every absolute clock minute moved by `delta` --
    and this engine keeps none, which is what this function exists to say.

    A time loop that keeps the investigators but rewinds the clock (§15.2
    `reset.investigators: keep` with `reset.clock: anchor`) asks every engine with a file
    under `save/` how that file follows the clock, and refuses the rewind for a file whose
    engine has not answered. The honest answer here is "nothing moves".
    `regen_remainder_minutes` looks like a clock reading and is not one: it is how many
    minutes of the current hour have been banked toward the next regenerated point -- a
    length in [0, 59], the same length whatever minute the clock now shows -- and `mp`,
    `mp_max` and `current_hp` are amounts. `delta` (the new clock minus the old) is accepted
    and unused. Returns a copy; `state` is not touched."""
    del delta
    return copy.deepcopy(state)


class MPool:
    """Structured MP pool for one investigator; overspill below 0 costs HP 1:1."""

    def __init__(self, investigator_id: str, pow_value: int, rng: random.Random | None = None, *,
                 mp_economy: dict[str, Any] | None = None, current_hp: int | None = None,
                 regen_remainder_minutes: int = 0) -> None:
        self.investigator_id = investigator_id
        self.pow_value = int(pow_value)
        self._rng = rng or random.Random()
        self._mp_economy = mp_economy or dict(_DEFAULT_ECONOMY)
        self.mp_max = self.pow_value // 5
        self.current_mp = self.mp_max
        self.current_hp = current_hp
        #: Minutes advanced since the last full hour paid out (§10, Magic Points: the
        #: regen rate is stated per whole hour, not as a continuous fraction). Banked
        #: here instead of discarded so a keeper who advances the clock in ordinary
        #: 5-20 minute steps still recovers the point once those steps add up to an
        #: hour; see `regen_mp`. Always in [0, 59]; persisted by `snapshot`/`save`/`load`.
        self.regen_remainder_minutes = int(regen_remainder_minutes)
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
        """Chapter 10: "Regeneration of Magic points is a natural function, returning at
        one Magic point per hour ... The number of Magic points cannot regenerate to a
        value above one-fifth of the character's POW." The rulebook states the rate as a
        whole-hour step (one point PER HOUR), not a fraction that accrues continuously —
        so an advance that has not yet reached a full hour has earned nothing YET, but the
        minutes are not thrown away either: they bank in `regen_remainder_minutes` and
        combine with the next call.

        This replaced a hard `if gain < 1: gain = 1` floor (defect #75): with that floor,
        any nonzero advance at all — a keeper passing 5 minutes — rounded `0.083h * 1/hr`
        up to a free point, so a session of small time-advances handed out far more MP
        than the hour had earned. Banking in minutes (not fractional hours) also means the
        carry is exact — no float drift across many small advances — and round-trips
        through the JSON snapshot as a plain integer.
        """
        if hours <= 0:
            return 0
        minutes = int(round(hours * 60))
        if minutes <= 0:
            return 0
        total_minutes = self.regen_remainder_minutes + minutes
        whole_hours, self.regen_remainder_minutes = divmod(total_minutes, 60)
        if whole_hours <= 0:
            return 0  # under an hour banked so far: nothing paid out yet, nothing lost
        gain = whole_hours * self.regen_per_hour
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
                                 "remainder_minutes": self.regen_remainder_minutes,
                                 "summary": f"{self.investigator_id} regenerated {actual_gain} MP over {hours}h rest ({source})."})
        return actual_gain

    def snapshot(self) -> dict[str, Any]:
        return {"investigator_id": self.investigator_id, "pow_value": self.pow_value, "mp_max": self.mp_max,
                "mp": self.current_mp, "current_hp": self.current_hp,
                "regen_remainder_minutes": self.regen_remainder_minutes, "events": list(self.events)}

    def save(self, campaign_dir: Path) -> Path:
        data = read_mp_state(campaign_dir, self.investigator_id)
        data.update({"investigator_id": self.investigator_id, "mp": self.current_mp, "mp_max": self.mp_max,
                     "regen_remainder_minutes": self.regen_remainder_minutes})
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
        if "regen_remainder_minutes" in data:
            pool.regen_remainder_minutes = int(data["regen_remainder_minutes"])
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
