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
- Natural recovery (p.121):
  - Rest (no major wound): restore 1 HP per day of rest.
  - Major wound: a CON roll at the end of each *week* determines rate:
    failure = 0 HP, regular = 1D3 HP, extreme = 2D3 HP (+ bonus/penalty dice
    for rest quality and medical care).
- Dying (p.121): only First Aid can stabilize a dying character (1 temporary
  HP); Medicine then clears the dying tick (+1D3). While dying: CON roll each
  round or die; once stabilized: CON roll each hour or revert to dying.

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
        # Dying is condition-driven (p.121): 0 HP with only regular damage is
        # unconscious, not dying, and heals normally.
        return "dying" in self.conditions

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

        Dying characters (p.121): only First Aid can stabilize them — success
        grants 1 temporary HP and the `stabilized` condition; the dying tick
        stays until a successful Medicine roll clears it.
        """
        if self.is_dying and "stabilized" not in self.conditions:
            res = skill_roll_result or coc_roll.percentile_check(
                skill_value, difficulty=difficulty, rng=self._rng)
            success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
            if success:
                self.current_hp = 1
                self.conditions.append("stabilized")
            return self._event("first_aid_stabilize" if success else "first_aid", {
                "skill": "First Aid", "difficulty": difficulty,
                "outcome": res.get("outcome"), "pushed": pushed,
                "stabilized": success,
                "hp_after": self.current_hp,
                "rule_ref": "core.combat.dying_stabilize",
                "summary": (f"{self.investigator_id} First Aid on dying -> "
                            f"{res.get('outcome')}: "
                            + ("stabilized at 1 temporary HP."
                               if success else "failed to stabilize.")),
            })
        if self.is_dying:
            return self._event("healing_skipped", {
                "reason": ("dying but already stabilized; use Medicine to "
                           "clear dying (p.121)"),
                "summary": f"{self.investigator_id} already stabilized; Medicine next.",
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

        Dying characters (p.121): Medicine cannot stabilize them (First Aid
        first). Once stabilized, a successful Medicine roll clears the dying
        tick and restores 1D3 HP.
        """
        if self.is_dying and "stabilized" not in self.conditions:
            return self._event("healing_skipped", {
                "reason": ("Medicine cannot stabilize a dying character; "
                           "First Aid first (p.121)"),
                "summary": f"{self.investigator_id} needs First Aid stabilization first.",
            })
        clearing_dying = self.is_dying and "stabilized" in self.conditions
        difficulty = "regular" if same_day else "hard"
        res = skill_roll_result
        if res is None:
            res = coc_roll.percentile_check(skill_value, difficulty=difficulty, rng=self._rng)
        success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
        hp_before = self.current_hp
        hp_gained = 0
        if success and not self._medicine_used_today:
            if clearing_dying:
                # p.121: uncheck the dying box, then heal 1D3.
                self.conditions.remove("dying")
                self.conditions.remove("stabilized")
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
    # Dying CON clocks (p.121)
    # ------------------------------------------------------------------ #
    def dying_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: a dying investigator makes a CON roll at the end of each
        round; failure = immediate death."""
        res = roll_result or coc_roll.percentile_check(self.con_value, rng=self._rng)
        died = res.get("outcome") in ("failure", "fumble")
        if died and "dead" not in self.conditions:
            self.conditions.append("dead")
        return self._event("dying_con_roll", {
            "outcome": res.get("outcome"), "died": died,
            "rule_ref": "core.combat.dying_con_clock",
            "summary": (f"{self.investigator_id} dying CON roll -> {res.get('outcome')}"
                        + (": dies." if died else ": holds on.")),
        })

    def stabilized_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: a stabilized (1 temporary HP) investigator makes a CON roll
        at the end of each hour; failure = lose the temporary HP and revert to
        the start of the dying process (First Aid needed again)."""
        res = roll_result or coc_roll.percentile_check(self.con_value, rng=self._rng)
        deteriorated = res.get("outcome") in ("failure", "fumble")
        if deteriorated:
            self.current_hp = 0
            if "stabilized" in self.conditions:
                self.conditions.remove("stabilized")
        return self._event("stabilized_con_roll", {
            "outcome": res.get("outcome"), "deteriorated": deteriorated,
            "rule_ref": "core.combat.dying_stabilized_clock",
            "summary": (f"{self.investigator_id} hourly CON roll -> {res.get('outcome')}"
                        + (": condition deteriorates, back to dying."
                           if deteriorated else ": stable.")),
        })

    # ------------------------------------------------------------------ #
    # Weekly/daily recovery (p.121)
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


# --------------------------------------------------------------------------- #
# Psychotherapy / asylum / self-help recovery (p.164)
# --------------------------------------------------------------------------- #
class PsychotherapySession:
    """Structured SAN-recovery-via-treatment state for one investigator.

    Implements the Chapter 8 (p.164) treatment paths:
    - Psychoanalysis: a weekly Psychoanalysis skill roll; success gives a
      chance to recover 1D3 SAN (regular) or more (hard/extreme).
    - Asylum confinement: 1D6 months of confinement, after which a Psychoanalysis
      roll determines recovery (p.164).
    - Self-help: a SAN roll; success recovers 1D6 SAN, failure loses 1 SAN.

    The session mutates a supplied SAN state dict (``current_san``, ``max_san``)
    and emits structured events. It is deterministic given the RNG.
    """

    def __init__(self, investigator_id: str,
                 san_state: dict[str, Any],
                 rng: random.Random | None = None) -> None:
        self.investigator_id = investigator_id
        self._rng = rng or random.Random()
        self.san_state = san_state  # {current_san, max_san, ...} mutated in place
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0
        # Track asylum confinement (months remaining).
        self.asylum_months_remaining = 0

    @property
    def current_san(self) -> int:
        return int(self.san_state.get("current_san", 0))

    @property
    def max_san(self) -> int:
        return int(self.san_state.get("max_san", 99))

    def _set_san(self, value: int) -> int:
        """Set current SAN, clamped to [0, max_san]. Returns the new value."""
        new_val = max(0, min(self.max_san, int(value)))
        self.san_state["current_san"] = new_val
        return new_val

    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"ps{self._event_counter}", **payload}
        self.events.append(ev)
        return ev

    # ------------------------------------------------------------------ #
    # Psychoanalysis (weekly)
    # ------------------------------------------------------------------ #
    def psychoanalysis(self, skill_value: int, *,
                       difficulty: str = "regular") -> dict[str, Any]:
        """Weekly Psychoanalysis skill roll (p.164).

        Success offers a recovery chance: regular success -> 1D3 SAN,
        hard -> 2D3, extreme -> 3D3. Failure yields no recovery (but no loss).
        Returns the event record.
        """
        res = coc_roll.percentile_check(skill_value, difficulty=difficulty,
                                        rng=self._rng)
        outcome = res.get("outcome")
        san_before = self.current_san
        recovered = 0
        if outcome == "extreme":
            dice = coc_roll.roll_expression("3D3", rng=self._rng)
            recovered = self._recover(int(dice.get("total", 0)))
        elif outcome == "hard":
            dice = coc_roll.roll_expression("2D3", rng=self._rng)
            recovered = self._recover(int(dice.get("total", 0)))
        elif outcome in ("regular", "critical"):
            dice = coc_roll.roll_expression("1D3", rng=self._rng)
            recovered = self._recover(int(dice.get("total", 0)))
        return self._event("psychoanalysis", {
            "skill": "Psychoanalysis",
            "difficulty": difficulty,
            "outcome": outcome,
            "san_before": san_before,
            "san_recovered": recovered,
            "san_after": self.current_san,
            "summary": (f"{self.investigator_id} Psychoanalysis ({difficulty}) "
                        f"-> {outcome}: +{recovered} SAN."),
        })

    # ------------------------------------------------------------------ #
    # Asylum confinement (1D6 months)
    # ------------------------------------------------------------------ #
    def confine_to_asylum(self) -> dict[str, Any]:
        """Confine the investigator to an asylum for 1D6 months (p.164).

        Sets ``asylum_months_remaining`` and emits an event. Actual recovery is
        resolved by ``resolve_asylum_release`` after the confinement period.
        """
        months = self._rng.randint(1, 6)
        self.asylum_months_remaining = months
        return self._event("asylum_confinement", {
            "months": months,
            "summary": (f"{self.investigator_id} committed to asylum for "
                        f"{months} month(s)."),
        })

    def resolve_asylum_release(self, psychoanalysis_skill: int) -> dict[str, Any]:
        """Resolve SAN recovery at the end of asylum confinement (p.164).

        A Psychoanalysis roll determines whether the investigator recovers. On
        success they recover to their max SAN (treatment worked); on failure
        they remain at their current SAN. Clears ``asylum_months_remaining``.
        """
        months = self.asylum_months_remaining
        self.asylum_months_remaining = 0
        res = coc_roll.percentile_check(psychoanalysis_skill, rng=self._rng)
        outcome = res.get("outcome")
        san_before = self.current_san
        recovered = 0
        if outcome in ("regular", "hard", "extreme", "critical"):
            # Treatment successful: recover to max SAN.
            recovered = self.max_san - san_before
            self._set_san(self.max_san)
        return self._event("asylum_release", {
            "psychoanalysis_outcome": outcome,
            "months_confined": months,
            "san_before": san_before,
            "san_recovered": recovered,
            "san_after": self.current_san,
            "summary": (f"{self.investigator_id} released from asylum after "
                        f"{months}m: Psychoanalysis {outcome}, "
                        f"+{recovered} SAN."),
        })

    # ------------------------------------------------------------------ #
    # Self-help (SAN roll)
    # ------------------------------------------------------------------ #
    def self_help(self) -> dict[str, Any]:
        """Self-help recovery via a SAN roll (p.164).

        Success: recover 1D6 SAN. Failure: lose 1 SAN.
        """
        res = coc_roll.percentile_check(self.current_san, rng=self._rng)
        outcome = res.get("outcome")
        san_before = self.current_san
        if outcome in ("regular", "hard", "extreme", "critical"):
            dice = coc_roll.roll_expression("1D6", rng=self._rng)
            recovered = self._recover(int(dice.get("total", 0)))
            san_delta = recovered
        else:
            # Failure: lose 1 SAN.
            self._set_san(self.current_san - 1)
            san_delta = -1
        return self._event("self_help", {
            "outcome": outcome,
            "san_before": san_before,
            "san_delta": san_delta,
            "san_after": self.current_san,
            "summary": (f"{self.investigator_id} self-help SAN roll "
                        f"{outcome}: SAN {san_before}->{self.current_san}."),
        })

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _recover(self, amount: int) -> int:
        """Apply SAN recovery, capped at max_san. Returns actual gain."""
        if amount <= 0:
            return 0
        before = self.current_san
        self._set_san(before + amount)
        return self.current_san - before

    def snapshot(self) -> dict[str, Any]:
        return {
            "investigator_id": self.investigator_id,
            "current_san": self.current_san,
            "max_san": self.max_san,
            "asylum_months_remaining": self.asylum_months_remaining,
            "events": list(self.events),
        }

