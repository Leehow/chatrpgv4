#!/usr/bin/env python3
"""Healing & recovery for Call of Cthulhu 7e — Chapter 6 (Combat) recovery rules.

Owns the structured healing/recovery state for one investigator across a
session, parallel to SanitySession for SAN. Produces structured healing
events (first_aid, medicine, weekly_recovery, rest) and persists HP into
the investigator-state record.

Rulebook basis (7e 40th Anniversary):
- First Aid (First Aid skill, p.119): success restores 1 HP. Can be pushed
  once. Each investigator can only receive First Aid once per wound.
- Medicine (Medicine skill, p.120): success restores 1D3 HP. Hard difficulty
  if the wound is not from the same day. Cannot be combined with First Aid
  on the same wound in the same day.
- Natural recovery (p.122):
  - Rest: restore 1 HP per day of rest.
  - Major wound: a CON roll at the end of each day of rest determines rate:
    failure = 0 HP, regular = 1D3 HP, extreme = 2D3 HP.
- Dying/unconscious investigators cannot heal until stabilized (p.121).

Files managed:
  save/investigator-state/<id>.json  — `current_hp` field (merged)
  logs/events.jsonl                  — healing events (shared)
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


coc_roll = _load_sibling("coc_roll", "coc_roll.py")


# --------------------------------------------------------------------------- #
# Investigator-state read/write (merge current_hp/conditions)
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _append_event(campaign_dir: Path, event: dict[str, Any]) -> None:
    path = campaign_dir / "logs" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# HealingSession
# --------------------------------------------------------------------------- #
class HealingSession:
    """Structured healing/recovery state for one investigator.

    Tracks HP, wound/healing history, and applies First Aid / Medicine /
    natural recovery. HP is capped at `hp_max`. Persisted into the
    investigator-state record.

    The session is deterministic given the RNG it is handed.
    """

    def __init__(
        self,
        investigator_id: str,
        hp_max: int,
        con_value: int,
        rng: random.Random | None = None,
        *,
        current_hp: int | None = None,
        conditions: list[str] | None = None,
    ) -> None:
        self.investigator_id = investigator_id
        self.hp_max = int(hp_max)
        self.con_value = int(con_value)
        self._rng = rng or random.Random()
        self.current_hp = current_hp if current_hp is not None else self.hp_max
        self.conditions: list[str] = list(conditions or [])
        # Per-wound tracking: once a wound received First Aid or Medicine,
        # it cannot receive the same treatment again that day.
        self._first_aid_used_today = False
        self._medicine_used_today = False
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0

    # ------------------------------------------------------------------ #
    # State helpers
    # ------------------------------------------------------------------ #
    @property
    def has_major_wound(self) -> bool:
        return "major_wound" in self.conditions

    @property
    def is_dying(self) -> bool:
        return "dying" in self.conditions or self.current_hp <= 0

    @property
    def is_unconscious(self) -> bool:
        return "unconscious" in self.conditions

    def _heal(self, amount: int) -> int:
        """Apply healing, capped at hp_max. Returns actual HP gained."""
        if amount <= 0 or self.is_dying:
            return 0
        before = self.current_hp
        self.current_hp = min(self.hp_max, self.current_hp + amount)
        gained = self.current_hp - before
        # Healing out of major_wound / dying once HP is sufficient
        if gained > 0:
            if self.current_hp > 0 and "dying" in self.conditions:
                self.conditions.remove("dying")
            # major_wound clears once HP restored to >= half max (heuristic; p.122)
            if self.current_hp >= self.hp_max // 2 and "major_wound" in self.conditions:
                self.conditions.remove("major_wound")
        return gained

    # ------------------------------------------------------------------ #
    # First Aid (p.119)
    # ------------------------------------------------------------------ #
    def first_aid(self, skill_value: int, skill_roll_result: dict | None = None,
                  *, difficulty: str = "regular", pushed: bool = False) -> dict[str, Any]:
        """First Aid skill check (p.119): success restores 1 HP.

        Parameters:
            skill_value: the investigator's First Aid skill %.
            skill_roll_result: pre-resolved percentile roll (must contain
                `outcome`). If None, the roll is performed here.
            difficulty: "regular" (default) or "hard".
            pushed: if True, this is a pushed roll (can only push once).

        Each investigator can only receive First Aid once per wound (tracked
        via `_first_aid_used_today`). Returns the event record.
        """
        if self.is_dying:
            return self._event("healing_skipped", {
                "reason": "investigator is dying; stabilize before healing",
                "summary": f"{self.investigator_id} cannot heal while dying.",
            })
        res = skill_roll_result
        if res is None:
            res = coc_roll.percentile_check(skill_value, difficulty=difficulty, rng=self._rng)
        success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
        hp_before = self.current_hp
        hp_gained = 0
        already_used = self._first_aid_used_today and not pushed
        if success and not already_used:
            hp_gained = self._heal(1)
            self._first_aid_used_today = True
        event = self._event("first_aid", {
            "skill": "First Aid",
            "difficulty": difficulty,
            "outcome": res.get("outcome"),
            "pushed": pushed,
            "already_used_today": already_used,
            "hp_before": hp_before,
            "hp_gained": hp_gained,
            "hp_after": self.current_hp,
            "summary": (
                f"{self.investigator_id} First Aid ({difficulty}) "
                f"-> {res.get('outcome')}: +{hp_gained} HP"
                + (" [pushed]" if pushed else "")
                + (" [already used today]" if already_used else "")
                + "."
            ),
        })
        return event

    # ------------------------------------------------------------------ #
    # Medicine (p.120)
    # ------------------------------------------------------------------ #
    def medicine(self, skill_value: int, skill_roll_result: dict | None = None,
                 *, same_day: bool = True) -> dict[str, Any]:
        """Medicine skill check (p.120): success restores 1D3 HP.

        Hard difficulty if the wound is not from the same day (`same_day=False`).
        Cannot combine with First Aid on the same wound in the same day.
        Returns the event record.
        """
        if self.is_dying:
            return self._event("healing_skipped", {
                "reason": "investigator is dying; stabilize before healing",
                "summary": f"{self.investigator_id} cannot heal while dying.",
            })
        difficulty = "regular" if same_day else "hard"
        res = skill_roll_result
        if res is None:
            res = coc_roll.percentile_check(skill_value, difficulty=difficulty, rng=self._rng)
        success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
        hp_before = self.current_hp
        hp_gained = 0
        if success and not self._medicine_used_today:
            dice = coc_roll.roll_expression("1D3", rng=self._rng)
            roll_total = int(dice.get("total", 1))
            hp_gained = self._heal(roll_total)
            self._medicine_used_today = True
        event = self._event("medicine", {
            "skill": "Medicine",
            "difficulty": difficulty,
            "outcome": res.get("outcome"),
            "hp_before": hp_before,
            "hp_gained": hp_gained,
            "hp_after": self.current_hp,
            "summary": (
                f"{self.investigator_id} Medicine ({difficulty}) "
                f"-> {res.get('outcome')}: +{hp_gained} HP."
            ),
        })
        return event

    # ------------------------------------------------------------------ #
    # Weekly/daily recovery (p.122)
    # ------------------------------------------------------------------ #
    def weekly_recovery(self, days_of_rest: int) -> dict[str, Any]:
        """Natural recovery over days of rest (p.122).

        - Without a major wound: restore 1 HP per day of rest.
        - With a major wound: a CON roll at the end of each day determines
          the rate: failure = 0 HP, regular = 1D3 HP, extreme = 2D3 HP.

        Returns the event record (aggregate over the rest period).
        """
        if days_of_rest <= 0:
            return self._event("weekly_recovery", {
                "days_of_rest": 0, "hp_gained": 0,
                "summary": f"{self.investigator_id} no rest taken.",
            })
        hp_before = self.current_hp
        total_gained = 0
        rolls: list[dict[str, Any]] = []
        had_major_wound = self.has_major_wound
        if had_major_wound:
            for day in range(days_of_rest):
                con_res = coc_roll.percentile_check(self.con_value, rng=self._rng)
                outcome = con_res.get("outcome")
                if outcome == "extreme":
                    dice = coc_roll.roll_expression("2D3", rng=self._rng)
                    gained = self._heal(int(dice.get("total", 0)))
                elif outcome in ("regular", "hard", "critical"):
                    dice = coc_roll.roll_expression("1D3", rng=self._rng)
                    gained = self._heal(int(dice.get("total", 0)))
                else:  # failure / fumble
                    gained = 0
                total_gained += gained
                rolls.append({"day": day + 1, "con_outcome": outcome, "hp_gained": gained})
        else:
            # No major wound: 1 HP/day of rest
            total_gained = self._heal(days_of_rest)
        event = self._event("weekly_recovery", {
            "days_of_rest": days_of_rest,
            "had_major_wound": had_major_wound,
            "hp_before": hp_before,
            "hp_gained": total_gained,
            "hp_after": self.current_hp,
            "con_rolls": rolls if had_major_wound else None,
            "summary": (
                f"{self.investigator_id} recovered {total_gained} HP over "
                f"{days_of_rest} day(s) of rest"
                + (" (major wound: CON rolls)" if rolls else "")
                + "."
            ),
        })
        return event

    # ------------------------------------------------------------------ #
    # Daily reset (called by coc_time end-of-day / anchor)
    # ------------------------------------------------------------------ #
    def reset_daily_treatments(self) -> None:
        """Reset the per-wound First Aid / Medicine trackers for a new day."""
        self._first_aid_used_today = False
        self._medicine_used_today = False

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "investigator_id": self.investigator_id,
            "hp_max": self.hp_max,
            "current_hp": self.current_hp,
            "con_value": self.con_value,
            "conditions": list(self.conditions),
            "events": list(self.events),
        }

    def save(self, campaign_dir: Path) -> Path:
        """Merge `current_hp` + `conditions` into investigator-state. Returns path."""
        data = _read_inv_state(campaign_dir, self.investigator_id)
        data["current_hp"] = self.current_hp
        data["conditions"] = list(self.conditions)
        _write_inv_state(campaign_dir, self.investigator_id, data)
        return _inv_state_path(campaign_dir, self.investigator_id)

    def persist_events(self, campaign_dir: Path) -> None:
        for ev in self.events:
            _append_event(campaign_dir, ev)

    @classmethod
    def load(cls, campaign_dir: Path, investigator_id: str,
             hp_max: int, con_value: int,
             rng: random.Random | None = None) -> "HealingSession":
        """Reconstruct from saved investigator-state, if present."""
        data = _read_inv_state(campaign_dir, investigator_id)
        sess = cls(
            investigator_id, hp_max, con_value, rng,
            current_hp=data.get("current_hp", hp_max),
            conditions=data.get("conditions", []),
        )
        return sess

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"hl{self._event_counter}", **payload}
        self.events.append(ev)
        return ev


# --------------------------------------------------------------------------- #
# coc_time integration: downtime/sleep triggers healing
# --------------------------------------------------------------------------- #
def handle_time_trigger(
    campaign_dir: Path,
    investigator_id: str,
    hp_max: int,
    con_value: int,
    delta_minutes: int,
    *,
    source: str = "sleep_night",
    rng: random.Random | None = None,
    had_major_wound: bool = False,
) -> int:
    """Apply natural healing for a downtime/sleep time advance.

    Treats the advance as rest: at least 6h counts as a full night's sleep
    (1 day of rest recovery, p.122). Resets daily First Aid/Medicine trackers.
    Returns the HP gained.

    Set `had_major_wound=True` when the investigator is recovering from a
    major wound so the CON-roll rate applies.
    """
    if delta_minutes <= 0:
        return 0
    sess = HealingSession.load(campaign_dir, investigator_id, hp_max, con_value, rng)
    if had_major_wound and "major_wound" not in sess.conditions:
        sess.conditions.append("major_wound")
    # A sleep_night (>=6h = 360 min) counts as one day of rest recovery.
    if delta_minutes >= 360:
        days = max(1, delta_minutes // 480)  # ~8h per full day of rest
        days = min(days, 7)  # cap weekly_recovery per call to a week
        sess.weekly_recovery(days)
    # Reset daily trackers for the new day.
    sess.reset_daily_treatments()
    gained = sess.current_hp - HealingSession.load(
        campaign_dir, investigator_id, hp_max, con_value, rng
    ).current_hp
    sess.save(campaign_dir)
    sess.persist_events(campaign_dir)
    return max(0, gained)
