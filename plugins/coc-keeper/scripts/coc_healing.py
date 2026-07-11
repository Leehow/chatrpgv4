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
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")


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
    coc_fileio.write_json_atomic(
        path, data, indent=2, ensure_ascii=False, trailing_newline=True
    )


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
        healing_usage: dict[str, Any] | None = None,
    ) -> None:
        self.investigator_id = investigator_id
        self.hp_max = int(hp_max)
        self.con_value = int(con_value)
        self._rng = rng or random.Random()
        self.current_hp = current_hp if current_hp is not None else self.hp_max
        self.conditions: list[str] = list(conditions or [])
        # Per-wound tracking: once a wound received First Aid or Medicine,
        # it cannot receive the same treatment again that day.
        usage = healing_usage if isinstance(healing_usage, dict) else {}
        self.wound_id = str(usage.get("active_wound_id") or usage.get("wound_id") or "active-wound")
        self.day_id = str(usage.get("active_day_id") or usage.get("day_id") or "day-0")
        raw_records = usage.get("records") if isinstance(usage.get("records"), dict) else {}
        self._usage_records: dict[str, dict[str, dict[str, bool]]] = {
            str(wound): {
                str(day): {
                    "first_aid_used": flags.get("first_aid_used") is True,
                    "medicine_used": flags.get("medicine_used") is True,
                }
                for day, flags in days.items() if isinstance(flags, dict)
            }
            for wound, days in raw_records.items() if isinstance(days, dict)
        }
        if not self._usage_records and any(key in usage for key in ("first_aid_used", "medicine_used")):
            self._usage_records = {self.wound_id: {self.day_id: {
                "first_aid_used": usage.get("first_aid_used") is True,
                "medicine_used": usage.get("medicine_used") is True,
            }}}
        self._load_usage_flags()
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
        if self.is_dying and "stabilized" in self.conditions:
            return self._event("healing_skipped", {
                "reason": ("dying but already stabilized; use Medicine to "
                           "clear dying (p.121)"),
                "summary": f"{self.investigator_id} already stabilized; Medicine next.",
            })
        if self._first_aid_used_today and not pushed:
            return self._event("first_aid", {
                "skill": "First Aid", "difficulty": difficulty,
                "outcome": None, "pushed": pushed, "already_used_today": True,
                "hp_before": self.current_hp, "hp_gained": 0,
                "hp_after": self.current_hp,
                "summary": f"{self.investigator_id} First Aid already used today.",
            })
        if self.is_dying and "stabilized" not in self.conditions:
            res = skill_roll_result or coc_roll.percentile_check(
                skill_value, difficulty=difficulty, rng=self._rng)
            self._first_aid_used_today = True
            success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
            if success:
                self.current_hp = 1
                self.conditions.append("stabilized")
            return self._event("first_aid_stabilize" if success else "first_aid", {
                "skill": "First Aid", "difficulty": difficulty,
                "outcome": res.get("outcome"), "roll": res.get("roll"),
                "target": skill_value, "pushed": pushed,
                "already_used_today": False,
                "stabilized": success,
                "hp_after": self.current_hp,
                "rule_ref": "core.combat.dying_stabilize",
                "summary": (f"{self.investigator_id} First Aid on dying -> "
                            f"{res.get('outcome')}: "
                            + ("stabilized at 1 temporary HP."
                               if success else "failed to stabilize.")),
            })
        res = skill_roll_result
        if res is None:
            res = coc_roll.percentile_check(skill_value, difficulty=difficulty, rng=self._rng)
        success = res.get("outcome") in ("regular", "hard", "extreme", "critical")
        hp_before = self.current_hp
        hp_gained = 0
        already_used = False
        self._first_aid_used_today = True
        if success and not already_used:
            hp_gained = self._heal(1)
            self._first_aid_used_today = True
        event = self._event("first_aid", {
            "skill": "First Aid",
            "difficulty": difficulty,
            "outcome": res.get("outcome"),
            "roll": res.get("roll"), "target": skill_value,
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
        if self._medicine_used_today:
            return self._event("medicine", {
                "skill": "Medicine", "difficulty": "regular" if same_day else "hard",
                "outcome": None, "already_used_today": True,
                "hp_before": self.current_hp, "hp_gained": 0, "hp_after": self.current_hp,
                "summary": f"{self.investigator_id} Medicine already used today.",
            })
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
        elif not self._medicine_used_today:
            # An attempted treatment consumes the persisted daily use even
            # when the check fails; a new command cannot reroll it after reload.
            self._medicine_used_today = True
        event = self._event("medicine", {
            "skill": "Medicine",
            "difficulty": difficulty,
            "outcome": res.get("outcome"),
            "roll": res.get("roll"), "target": skill_value,
            "already_used_today": False,
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
            "outcome": res.get("outcome"), "roll": res.get("roll"),
            "target": self.con_value, "difficulty": "regular", "died": died,
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
            "outcome": res.get("outcome"), "roll": res.get("roll"),
            "target": self.con_value, "difficulty": "regular", "deteriorated": deteriorated,
            "rule_ref": "core.combat.dying_stabilized_clock",
            "summary": (f"{self.investigator_id} hourly CON roll -> {res.get('outcome')}"
                        + (": condition deteriorates, back to dying."
                           if deteriorated else ": stable.")),
        })

    # ------------------------------------------------------------------ #
    # Weekly/daily recovery (p.121)
    # ------------------------------------------------------------------ #
    def weekly_recovery(self, days_of_rest: int) -> dict[str, Any]:
        """Natural recovery over days of rest (p.121).

        - Without a major wound: restore 1 HP per day of rest.
        - With a major wound: natural rest alone does not heal — recovery is
          resolved by the *weekly* CON roll (``major_wound_recovery_roll``);
          this method only flags that the weekly roll is required.

        Returns the event record (aggregate over the rest period).
        """
        if days_of_rest <= 0:
            return self._event("weekly_recovery", {
                "days_of_rest": 0, "hp_gained": 0,
                "summary": f"{self.investigator_id} no rest taken.",
            })
        hp_before = self.current_hp
        had_major_wound = self.has_major_wound
        if had_major_wound:
            return self._event("weekly_recovery", {
                "days_of_rest": days_of_rest,
                "had_major_wound": True,
                "hp_before": hp_before,
                "hp_gained": 0,
                "hp_after": self.current_hp,
                "major_wound_recovery_required": True,
                "rule_ref": "core.combat.major_wound_recovery",
                "summary": (f"{self.investigator_id} rested {days_of_rest} day(s) "
                            "with a major wound: healing requires the weekly "
                            "CON recovery roll (p.121)."),
            })
        total_gained = self._heal(days_of_rest)
        return self._event("weekly_recovery", {
            "days_of_rest": days_of_rest,
            "had_major_wound": False,
            "hp_before": hp_before,
            "hp_gained": total_gained,
            "hp_after": self.current_hp,
            "summary": (f"{self.investigator_id} recovered {total_gained} HP over "
                        f"{days_of_rest} day(s) of rest."),
        })

    def major_wound_recovery_roll(self, *, complete_rest: bool = False,
                                  medical_care_success: bool | None = None,
                                  poor_environment: bool = False,
                                  medicine_fumbled: bool = False,
                                  roll_result: dict | None = None) -> dict[str, Any]:
        """p.121: a CON roll at the end of each week the Major Wound box is
        ticked.

        - Failure: no recovery that week. Success: +1D3 HP. Extreme: +2D3 HP
          and the major wound is healed (marker erased).
        - +1 bonus die for complete rest in a comfortable environment; +1
          bonus die for effective medical care (weekly Medicine roll success).
        - +1 penalty die for a poor environment / insufficient rest, or when
          the carer's Medicine roll fumbled.
        - Fumble: a lasting injury or complication — the Keeper picks one tied
          to the wound and records it in the backstory (Wounds & Scars).
        """
        bonus = int(bool(complete_rest)) + int(bool(medical_care_success))
        penalty = int(bool(poor_environment) or bool(medicine_fumbled))
        res = roll_result or coc_roll.percentile_check(
            self.con_value, bonus=bonus, penalty=penalty, rng=self._rng)
        outcome = res.get("outcome")
        hp_before = self.current_hp
        gained = 0
        if outcome == "extreme":
            gained = self._heal(int(coc_roll.roll_expression("2D3", rng=self._rng)["total"]))
            if "major_wound" in self.conditions:
                self.conditions.remove("major_wound")
        elif outcome in ("regular", "hard", "critical"):
            gained = self._heal(int(coc_roll.roll_expression("1D3", rng=self._rng)["total"]))
        elif outcome == "fumble":
            self._event("lasting_injury", {
                "rule_ref": "core.combat.major_wound_recovery_fumble",
                "keeper_note": ("Pick a lasting injury/complication tied to the "
                                "nature of the wound (permanent limp, lost "
                                "fingers, scarred face ...) and record it in the "
                                "backstory under Wounds & Scars (p.121)."),
                "summary": f"{self.investigator_id} recovery fumble: lasting injury.",
            })
        # HP >= half max also clears the major wound (second path, p.121) —
        # handled by _heal.
        return self._event("major_wound_recovery", {
            "outcome": outcome, "bonus_dice": bonus, "penalty_dice": penalty,
            "hp_before": hp_before, "hp_gained": gained, "hp_after": self.current_hp,
            "rule_ref": "core.combat.major_wound_recovery",
            "summary": (f"{self.investigator_id} weekly recovery CON ({outcome}): "
                        f"+{gained} HP."),
        })

    # ------------------------------------------------------------------ #
    # Daily reset (called by coc_time end-of-day / anchor)
    # ------------------------------------------------------------------ #
    def reset_daily_treatments(self) -> None:
        """Reset the per-wound First Aid / Medicine trackers for a new day."""
        self._first_aid_used_today = False
        self._medicine_used_today = False
        self._store_usage_flags()

    def _load_usage_flags(self) -> None:
        flags = self._usage_records.get(self.wound_id, {}).get(self.day_id, {})
        self._first_aid_used_today = flags.get("first_aid_used") is True
        self._medicine_used_today = flags.get("medicine_used") is True

    def _store_usage_flags(self) -> None:
        self._usage_records.setdefault(self.wound_id, {})[self.day_id] = {
            "first_aid_used": self._first_aid_used_today,
            "medicine_used": self._medicine_used_today,
        }

    def set_usage_scope(self, wound_id: str, day_id: str) -> None:
        """Select the persisted wound/day bucket, resetting only on a new scope."""
        self._store_usage_flags()
        self.wound_id = wound_id
        self.day_id = day_id
        self._load_usage_flags()

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
            "healing_usage": self._healing_usage_snapshot(),
        }

    def _healing_usage_snapshot(self) -> dict[str, Any]:
        self._store_usage_flags()
        return {
            "active_wound_id": self.wound_id,
            "active_day_id": self.day_id,
            "records": {
                wound: {day: dict(flags) for day, flags in days.items()}
                for wound, days in self._usage_records.items()
            },
        }

    def save(self, campaign_dir: Path) -> Path:
        """Merge `current_hp` + `conditions` into investigator-state. Returns path."""
        data = _read_inv_state(campaign_dir, self.investigator_id)
        data["current_hp"] = self.current_hp
        data["conditions"] = list(self.conditions)
        data["healing_usage"] = self.snapshot()["healing_usage"]
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
            healing_usage=data.get("healing_usage"),
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
        days = min(days, 7)  # cap recovery per call to a week
        if sess.has_major_wound:
            # p.121: major wounds heal via a weekly CON roll, not per-day rest.
            for _ in range(days // 7):
                sess.major_wound_recovery_roll(complete_rest=True)
        else:
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
# Psychotherapy / asylum / self-help recovery (p.164-168)
# --------------------------------------------------------------------------- #

# Nine backstory categories (p.157); mirrored from coc_sanity / coc_state so
# self-help key_connection never scans prose (Semantic Matcher Constitution).
_BACKSTORY_FIELDS = (
    "personal_description",
    "ideology_beliefs",
    "significant_people",
    "meaningful_locations",
    "treasured_possessions",
    "traits",
    "injuries_scars",
    "phobias_manias",
    "encounters",
)

# Private-care monthly roll threshold (treatment.json psychoanalysis.monthly_roll).
_MONTHLY_SUCCESS_MAX = 95


class PsychotherapySession:
    """Structured SAN-recovery-via-treatment state for one investigator.

    Implements Chapter 8 (p.164-168) treatment paths:
    - Psychoanalysis: weekly skill roll (scaled 1D3/2D3/3D3) plus a separate
      monthly private-care 1D100 (01-95 +1D3 / 96-00 -1D6 setback).
    - Asylum confinement: 1D6 months; release resolves one monthly treatment
      roll (quality tiers grant bonus/penalty die). Never restores to max SAN
      in a single step.
    - Two-step indefinite cure: after >=1 successful monthly gain,
      ``cure_indefinite_check`` may clear indefinite insanity via SAN roll.
    - Self-help: SAN roll bound to a structured key_connection; failure
      returns a W1-2-shaped ``backstory_amend_required``.

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
        # Successful monthly +1D3 gains; gates cure_indefinite_check (p.164-168).
        self.monthly_gains_count = 0

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
        Returns the event record. This is not a full-restore path.
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
    # Monthly private-care / asylum treatment roll (p.164)
    # ------------------------------------------------------------------ #
    def monthly_treatment_roll(
        self,
        *,
        quality: str | None = None,
        rng: random.Random | None = None,
    ) -> dict[str, Any]:
        """Monthly private-care / asylum treatment roll (p.164).

        Flat 1D100 against success_range [1, 95]:
          - 01-95 → gain 1D3 SAN (increments ``monthly_gains_count``)
          - 96-00 → setback, lose 1D6 SAN

        Asylum quality tiers (treatment.json):
          - ``good`` → bonus die on the 1D100
          - ``poor`` → penalty die on the 1D100

        Uses ``coc_roll.percentile_check`` tens-die mechanics (target 95).
        Applies SAN changes in place, matching ``psychoanalysis()``.
        """
        active_rng = rng or self._rng
        bonus = 0
        penalty = 0
        if quality == "good":
            bonus = 1
        elif quality == "poor":
            penalty = 1
        elif quality is not None:
            raise ValueError(
                f"quality must be 'good', 'poor', or None, got {quality!r}")

        # Target 95: roll <= 95 is a monthly gain; 96-100 is a setback.
        res = coc_roll.percentile_check(
            _MONTHLY_SUCCESS_MAX,
            bonus=bonus,
            penalty=penalty,
            rng=active_rng,
        )
        roll = int(res.get("roll", 100))
        san_before = self.current_san
        setback = roll > _MONTHLY_SUCCESS_MAX
        if setback:
            dice = coc_roll.roll_expression("1D6", rng=active_rng)
            lost = int(dice.get("total", 0))
            self._set_san(self.current_san - lost)
            san_delta = self.current_san - san_before
        else:
            dice = coc_roll.roll_expression("1D3", rng=active_rng)
            gained = self._recover(int(dice.get("total", 0)))
            san_delta = gained
            if gained > 0:
                self.monthly_gains_count += 1

        return self._event("monthly_treatment", {
            "roll": roll,
            "bonus": int(res.get("bonus", 0)),
            "penalty": int(res.get("penalty", 0)),
            "quality": quality,
            "setback": setback,
            "san_before": san_before,
            "san_delta": san_delta,
            "san_after": self.current_san,
            "monthly_gains_count": self.monthly_gains_count,
            "summary": (
                f"{self.investigator_id} monthly treatment roll {roll}"
                f"{' (setback)' if setback else ''}: "
                f"SAN {san_before}->{self.current_san}."
            ),
        })

    # ------------------------------------------------------------------ #
    # Asylum confinement (1D6 months)
    # ------------------------------------------------------------------ #
    def confine_to_asylum(self, *, quality: str | None = None) -> dict[str, Any]:
        """Confine the investigator to an asylum for 1D6 months (p.164).

        Sets ``asylum_months_remaining`` and emits an event. Actual recovery is
        resolved by ``resolve_asylum_release`` / ``monthly_treatment_roll`` —
        never a single full restore to max SAN.
        """
        if quality is not None and quality not in ("good", "poor"):
            raise ValueError(
                f"quality must be 'good', 'poor', or None, got {quality!r}")
        months = self._rng.randint(1, 6)
        self.asylum_months_remaining = months
        self.asylum_quality = quality
        return self._event("asylum_confinement", {
            "months": months,
            "quality": quality,
            "summary": (f"{self.investigator_id} committed to asylum for "
                        f"{months} month(s)"
                        f"{f' ({quality})' if quality else ''}."),
        })

    def resolve_asylum_release(
        self,
        psychoanalysis_skill: int = 0,
        *,
        quality: str | None = None,
    ) -> dict[str, Any]:
        """Resolve SAN recovery at the end of asylum confinement (p.164-168).

        Neutralizes the former full-restore shortcut: release now resolves one
        ``monthly_treatment_roll`` (optional asylum quality die). The legacy
        ``psychoanalysis_skill`` argument is accepted for call-site compat but
        is unused — recovery is monthly cadence, not a skill-to-max restore.
        Clears ``asylum_months_remaining``.
        """
        del psychoanalysis_skill  # legacy API; monthly cadence replaces skill-to-max
        months = self.asylum_months_remaining
        self.asylum_months_remaining = 0
        effective_quality = quality
        if effective_quality is None:
            effective_quality = getattr(self, "asylum_quality", None)
        monthly = self.monthly_treatment_roll(quality=effective_quality)
        # Re-tag the monthly event as asylum_release while preserving fields.
        monthly["event_type"] = "asylum_release"
        monthly["months_confined"] = months
        monthly["san_recovered"] = max(0, int(monthly.get("san_delta", 0)))
        monthly["summary"] = (
            f"{self.investigator_id} released from asylum after {months}m: "
            f"monthly treatment roll {monthly.get('roll')}"
            f"{' (setback)' if monthly.get('setback') else ''}, "
            f"SAN {monthly.get('san_before')}->{monthly.get('san_after')}."
        )
        return monthly

    # ------------------------------------------------------------------ #
    # Two-step indefinite cure (p.164-168)
    # ------------------------------------------------------------------ #
    def cure_indefinite_check(self) -> dict[str, Any]:
        """Attempt to clear indefinite insanity after monthly gains (p.164-168).

        Requires ``monthly_gains_count >= 1``. Then rolls 1D100 <= current SAN;
        on success clears ``indefinite_insane`` on the session's san_state
        (caller may also route to SanitySession).
        """
        if self.monthly_gains_count < 1:
            return {
                "blocked": "monthly_gain_required",
                "monthly_gains_count": self.monthly_gains_count,
                "cured": False,
            }
        res = coc_roll.percentile_check(self.current_san, rng=self._rng)
        outcome = res.get("outcome")
        cured = outcome in ("regular", "hard", "extreme", "critical")
        if cured:
            self.san_state["indefinite_insane"] = False
        return self._event("cure_indefinite", {
            "roll": res.get("roll"),
            "target": self.current_san,
            "outcome": outcome,
            "cured": cured,
            "monthly_gains_count": self.monthly_gains_count,
            "summary": (
                f"{self.investigator_id} indefinite-cure check "
                f"{outcome}: cured={cured}."
            ),
        })

    # ------------------------------------------------------------------ #
    # Self-help (SAN roll + key_connection)
    # ------------------------------------------------------------------ #
    def self_help(self, *, key_connection: dict[str, Any]) -> dict[str, Any]:
        """Self-help recovery via a SAN roll bound to a key connection (p.165).

        ``key_connection`` is a structured reference::

            {"backstory_field": <one of nine p.157 categories>, "summary": str}

        Success: recover 1D6 SAN. Failure: lose 1 SAN and return
        ``backstory_amend_required`` (W1-2 ``corrupt_existing`` shape).
        """
        if not isinstance(key_connection, dict):
            raise TypeError("key_connection must be a dict")
        field = key_connection.get("backstory_field")
        if field not in _BACKSTORY_FIELDS:
            raise ValueError(
                f"key_connection.backstory_field must be one of "
                f"{_BACKSTORY_FIELDS}, got {field!r}")

        res = coc_roll.percentile_check(self.current_san, rng=self._rng)
        outcome = res.get("outcome")
        san_before = self.current_san
        payload: dict[str, Any] = {
            "outcome": outcome,
            "san_before": san_before,
            "key_connection": {
                "backstory_field": field,
                "summary": str(key_connection.get("summary", "")),
            },
        }
        if outcome in ("regular", "hard", "extreme", "critical"):
            dice = coc_roll.roll_expression("1D6", rng=self._rng)
            recovered = self._recover(int(dice.get("total", 0)))
            payload["san_delta"] = recovered
        else:
            self._set_san(self.current_san - 1)
            payload["san_delta"] = -1
            payload["backstory_amend_required"] = {
                "mode": "corrupt_existing",
                "backstory_field": field,
            }
        payload["san_after"] = self.current_san
        payload["summary"] = (
            f"{self.investigator_id} self-help SAN roll {outcome}: "
            f"SAN {san_before}->{self.current_san}."
        )
        return self._event("self_help", payload)

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
            "asylum_quality": getattr(self, "asylum_quality", None),
            "monthly_gains_count": self.monthly_gains_count,
            "events": list(self.events),
        }
