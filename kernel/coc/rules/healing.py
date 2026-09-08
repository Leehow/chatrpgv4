"""Healing & recovery (Chapter 6) and SAN treatment (Chapter 8). Ported from coc_healing.py.

Snapshot: `<campaign>/save/healing-state/<investigator>.json` holds `current_hp`,
`conditions`, `wound_ledger`, `healing_usage`; the settlement layer mirrors
`current_hp` into the party sheet. Events are returned to the caller rather than
appended to a log — the kernel's events.jsonl is a closed enum."""

from __future__ import annotations

import random
import re
from pathlib import Path
from typing import Any

from ..fileio import read_json, write_json_atomic
from . import percentile
from .tables import RuleTables

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SUCCESS = ("regular", "hard", "extreme", "critical")


def establish_damage_wound(state: dict[str, Any], *, decision_id: str, occurred_elapsed_minutes: int,
                           source_damage_roll_id: str | None) -> dict[str, Any]:
    """Ensure one semantic active-wound receipt for an HP-loss decision (idempotent)."""
    if not isinstance(state, dict):
        raise ValueError("investigator state must be an object")
    if not isinstance(decision_id, str) or not decision_id or decision_id != decision_id.strip():
        raise ValueError("damage decision id must be an exact non-empty string")
    wound_id = f"wound-{decision_id}"
    if _SAFE_ID.fullmatch(wound_id) is None:
        raise ValueError("damage decision id cannot form a safe semantic wound identity")
    if isinstance(occurred_elapsed_minutes, bool) or not isinstance(occurred_elapsed_minutes, int) or occurred_elapsed_minutes < 0:
        raise ValueError("injury elapsed minutes must be a non-negative integer")
    if source_damage_roll_id is not None and (not isinstance(source_damage_roll_id, str) or not source_damage_roll_id):
        raise ValueError("source damage roll id must be a non-empty string or null")
    ledger = state.get("wound_ledger")
    if ledger is None:
        ledger = []
    if not isinstance(ledger, list):
        raise ValueError("wound ledger must be a list")
    expected = {"wound_id": wound_id, "source_damage_roll_id": source_damage_roll_id,
                "occurred_elapsed_minutes": occurred_elapsed_minutes, "status": "active"}
    for row in ledger:
        if isinstance(row, dict) and row.get("wound_id") == wound_id:
            if row != expected:
                raise ValueError("semantic wound identity is already bound to different damage")
            state["wound_ledger"] = ledger
            return row
    ledger.append(expected)
    state["wound_ledger"] = ledger
    return expected


def healing_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / "save" / "healing-state" / f"{investigator_id}.json"


def read_healing_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = healing_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    data = read_json(path)
    return data if isinstance(data, dict) else {}


def write_healing_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> Path:
    path = healing_state_path(campaign_dir, investigator_id)
    write_json_atomic(path, data)
    return path


class HealingSession:
    """Structured healing/recovery state for one investigator (HP capped at hp_max)."""

    def __init__(self, tables: RuleTables, investigator_id: str, hp_max: int, con_value: int,
                 rng: random.Random | None = None, *, current_hp: int | None = None,
                 conditions: list[str] | None = None, healing_usage: dict[str, Any] | None = None,
                 wound_ledger: list[dict[str, Any]] | None = None,
                 recovery_ledger: list[dict[str, Any]] | None = None) -> None:
        self.tables = tables
        self.investigator_id = investigator_id
        self.hp_max = int(hp_max)
        self.con_value = int(con_value)
        self._rng = rng or random.Random()
        self.current_hp = current_hp if current_hp is not None else self.hp_max
        self.conditions: list[str] = list(conditions or [])
        self.wound_ledger: list[dict[str, Any]] = [dict(r) for r in (wound_ledger or []) if isinstance(r, dict)]
        self.major_wound_recovery_ledger: list[dict[str, Any]] = [dict(r) for r in (recovery_ledger or []) if isinstance(r, dict)]
        usage = healing_usage if isinstance(healing_usage, dict) else {}
        self.wound_id = str(usage.get("active_wound_id") or usage.get("wound_id") or "active-wound")
        self.day_id = str(usage.get("active_day_id") or usage.get("day_id") or "day-0")
        raw_records = usage.get("records") if isinstance(usage.get("records"), dict) else {}
        self._usage_records: dict[str, dict[str, dict[str, bool]]] = {
            str(wound): {str(day): {"first_aid_used": flags.get("first_aid_used") is True,
                                    "first_aid_push_used": flags.get("first_aid_push_used") is True,
                                    "medicine_used": flags.get("medicine_used") is True}
                         for day, flags in days.items() if isinstance(flags, dict)}
            for wound, days in raw_records.items() if isinstance(days, dict)
        }
        if not self._usage_records and any(k in usage for k in ("first_aid_used", "medicine_used")):
            self._usage_records = {self.wound_id: {self.day_id: {
                "first_aid_used": usage.get("first_aid_used") is True,
                "first_aid_push_used": usage.get("first_aid_push_used") is True,
                "medicine_used": usage.get("medicine_used") is True}}}
        self._load_usage_flags()
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0

    # ---- state -----------------------------------------------------------

    @property
    def has_major_wound(self) -> bool:
        return "major_wound" in self.conditions

    @property
    def is_dying(self) -> bool:
        return "dying" in self.conditions

    @property
    def is_unconscious(self) -> bool:
        return "unconscious" in self.conditions

    def _check(self, target: int, difficulty: str = "regular", bonus: int = 0, penalty: int = 0) -> dict[str, Any]:
        return percentile.percentile_check(self.tables, target, difficulty, bonus, penalty, rng=self._rng)

    def _heal(self, amount: int) -> int:
        if amount <= 0 or self.is_dying:
            return 0
        before = self.current_hp
        self.current_hp = min(self.hp_max, self.current_hp + amount)
        gained = self.current_hp - before
        if gained > 0:
            if not self.is_dying and "unconscious" in self.conditions:
                self.conditions.remove("unconscious")
            if self.current_hp > 0 and "dying" in self.conditions:
                self.conditions.remove("dying")
            if self.current_hp >= (self.hp_max + 1) // 2 and "major_wound" in self.conditions:
                self.conditions.remove("major_wound")
        return gained

    # ---- First Aid (p.119) --------------------------------------------------

    def first_aid(self, skill_value: int, skill_roll_result: dict | None = None, *,
                  difficulty: str = "regular", pushed: bool = False, rescuer_id: str | None = None,
                  assistant_skill_value: int | None = None, assistant_roll_result: dict | None = None,
                  assistant_rescuer_id: str | None = None) -> dict[str, Any]:
        has_assistant = assistant_skill_value is not None or assistant_rescuer_id is not None
        if has_assistant and (isinstance(assistant_skill_value, bool) or not isinstance(assistant_skill_value, int)
                              or not 1 <= assistant_skill_value <= 100 or not isinstance(assistant_rescuer_id, str)
                              or not assistant_rescuer_id.strip()):
            raise ValueError("assistant First Aid requires assistant_skill_value 1..100 and a non-empty assistant_rescuer_id")
        if assistant_roll_result is not None and not has_assistant:
            raise ValueError("assistant_roll_result requires an assistant First Aid rescuer")
        if self.is_dying and "stabilized" in self.conditions:
            return self._event("healing_skipped", {
                "reason": "dying but already stabilized; use Medicine to clear dying (p.121)",
                "summary": f"{self.investigator_id} already stabilized; Medicine next."})
        if pushed and not self._first_aid_used_today:
            return self._event("first_aid", {
                "skill": "First Aid", "difficulty": difficulty, "outcome": None, "pushed": True,
                "already_used_today": False, "push_unavailable": True, "hp_before": self.current_hp,
                "hp_gained": 0, "hp_after": self.current_hp,
                "summary": f"{self.investigator_id} has no failed First Aid attempt to push."})
        if pushed and self._first_aid_push_used_today:
            return self._event("first_aid", {
                "skill": "First Aid", "difficulty": difficulty, "outcome": None, "pushed": True,
                "already_used_today": True, "push_already_used": True, "hp_before": self.current_hp,
                "hp_gained": 0, "hp_after": self.current_hp,
                "summary": f"{self.investigator_id} First Aid push already used today."})
        if self._first_aid_used_today and not pushed:
            return self._event("first_aid", {
                "skill": "First Aid", "difficulty": difficulty, "outcome": None, "pushed": pushed,
                "already_used_today": True, "hp_before": self.current_hp, "hp_gained": 0,
                "hp_after": self.current_hp, "summary": f"{self.investigator_id} First Aid already used today."})
        primary = skill_roll_result or self._check(skill_value, difficulty)
        team_rolls: list[dict[str, Any]] = []
        res = primary
        if has_assistant:
            assistant = assistant_roll_result or self._check(int(assistant_skill_value), difficulty)
            team_rolls = [
                {"rescuer_id": str(rescuer_id or self.investigator_id), "outcome": primary.get("outcome"),
                 "roll": primary.get("roll"), "target": int(skill_value), "difficulty": difficulty},
                {"rescuer_id": str(assistant_rescuer_id), "outcome": assistant.get("outcome"),
                 "roll": assistant.get("roll"), "target": int(assistant_skill_value), "difficulty": difficulty},
            ]
            rank = {"regular": 1, "hard": 2, "extreme": 3, "critical": 4}
            successful = [row["outcome"] for row in team_rolls if row.get("outcome") in rank]
            if successful:
                outcome = max(successful, key=lambda item: rank[str(item)])
            elif any(row.get("outcome") == "fumble" for row in team_rolls):
                outcome = "fumble"
            else:
                outcome = "failure"
            res = {"outcome": outcome, "roll": None}

        if self.is_dying and "stabilized" not in self.conditions:
            self._first_aid_used_today = True
            if pushed:
                self._first_aid_push_used_today = True
            success = res.get("outcome") in SUCCESS
            if success:
                self.current_hp = 1
                self.conditions.append("stabilized")
            data = {"skill": "First Aid", "difficulty": difficulty, "outcome": res.get("outcome"),
                    "roll": res.get("roll"), "target": skill_value, "pushed": pushed, "already_used_today": False,
                    "stabilized": success, "hp_after": self.current_hp, "rule_ref": "core.combat.dying_stabilize",
                    "summary": (f"{self.investigator_id} First Aid on dying -> {res.get('outcome')}: "
                                + ("stabilized at 1 temporary HP." if success else "failed to stabilize.")),
                    "check": primary if not team_rolls else None}
            if team_rolls:
                data.update({"teamwork": True, "team_rolls": team_rolls})
            return self._event("first_aid_stabilize" if success else "first_aid", data)
        success = res.get("outcome") in SUCCESS
        hp_before = self.current_hp
        hp_gained = 0
        self._first_aid_used_today = True
        if pushed:
            self._first_aid_push_used_today = True
        if success:
            hp_gained = self._heal(1)
        data = {"skill": "First Aid", "difficulty": difficulty, "outcome": res.get("outcome"),
                "roll": res.get("roll"), "target": skill_value, "pushed": pushed, "already_used_today": False,
                "hp_before": hp_before, "hp_gained": hp_gained, "hp_after": self.current_hp,
                "summary": (f"{self.investigator_id} First Aid ({difficulty}) -> {res.get('outcome')}: "
                            f"+{hp_gained} HP" + (" [pushed]" if pushed else "") + "."),
                "check": primary if not team_rolls else None}
        if team_rolls:
            data.update({"teamwork": True, "team_rolls": team_rolls})
        return self._event("first_aid", data)

    # ---- Medicine (p.120) -----------------------------------------------------

    def medicine(self, skill_value: int, skill_roll_result: dict | None = None, *,
                 same_day: bool = True) -> dict[str, Any]:
        if self.is_dying and "stabilized" not in self.conditions:
            return self._event("healing_skipped", {
                "reason": "Medicine cannot stabilize a dying character; First Aid first (p.121)",
                "summary": f"{self.investigator_id} needs First Aid stabilization first."})
        clearing_dying = self.is_dying and "stabilized" in self.conditions
        difficulty = "regular" if same_day else "hard"
        if self._medicine_used_today:
            return self._event("medicine", {
                "skill": "Medicine", "difficulty": difficulty, "outcome": None, "already_used_today": True,
                "hp_before": self.current_hp, "hp_gained": 0, "hp_after": self.current_hp,
                "summary": f"{self.investigator_id} Medicine already used today."})
        res = skill_roll_result or self._check(skill_value, difficulty)
        success = res.get("outcome") in SUCCESS
        hp_before = self.current_hp
        hp_gained = 0
        healing_dice: dict[str, Any] | None = None
        if success:
            if clearing_dying:
                self.conditions.remove("dying")
                self.conditions.remove("stabilized")
                if "unconscious" in self.conditions:
                    self.conditions.remove("unconscious")
            dice = percentile.roll_expression("1D3", rng=self._rng)
            healing_dice = {"expression": "1D3", "raw": list(dice["rolls"]), "total": int(dice["total"])}
            hp_gained = self._heal(healing_dice["total"])
        self._medicine_used_today = True
        return self._event("medicine", {
            "skill": "Medicine", "difficulty": difficulty, "outcome": res.get("outcome"), "roll": res.get("roll"),
            "target": skill_value, "already_used_today": False, "hp_before": hp_before, "hp_gained": hp_gained,
            "hp_after": self.current_hp, "healing_dice": healing_dice, "check": res,
            "summary": f"{self.investigator_id} Medicine ({difficulty}) -> {res.get('outcome')}: +{hp_gained} HP."})

    # ---- dying CON clocks (p.121) ---------------------------------------------

    def dying_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        res = roll_result or self._check(self.con_value)
        died = res.get("outcome") in ("failure", "fumble")
        if died and "dead" not in self.conditions:
            self.conditions.append("dead")
        elif not died:
            self.reopen_subsequent_first_aid_attempt()
        return self._event("dying_con_roll", {
            "outcome": res.get("outcome"), "roll": res.get("roll"), "target": self.con_value,
            "difficulty": "regular", "died": died, "rule_ref": "core.combat.dying_con_clock", "check": res,
            "summary": f"{self.investigator_id} dying CON roll -> {res.get('outcome')}" + (": dies." if died else ": holds on.")})

    def stabilized_con_roll(self, roll_result: dict | None = None) -> dict[str, Any]:
        res = roll_result or self._check(self.con_value)
        deteriorated = res.get("outcome") in ("failure", "fumble")
        if deteriorated:
            self.current_hp = 0
            if "stabilized" in self.conditions:
                self.conditions.remove("stabilized")
            self.reopen_subsequent_first_aid_attempt()
        return self._event("stabilized_con_roll", {
            "outcome": res.get("outcome"), "roll": res.get("roll"), "target": self.con_value,
            "difficulty": "regular", "deteriorated": deteriorated, "rule_ref": "core.combat.dying_stabilized_clock",
            "check": res,
            "summary": (f"{self.investigator_id} hourly CON roll -> {res.get('outcome')}"
                        + (": condition deteriorates, back to dying." if deteriorated else ": stable."))})

    # ---- recovery (p.121) -----------------------------------------------------

    def weekly_recovery(self, days_of_rest: int) -> dict[str, Any]:
        if days_of_rest <= 0:
            return self._event("weekly_recovery", {"days_of_rest": 0, "hp_gained": 0,
                                                   "summary": f"{self.investigator_id} no rest taken."})
        hp_before = self.current_hp
        if self.has_major_wound:
            return self._event("weekly_recovery", {
                "days_of_rest": days_of_rest, "had_major_wound": True, "hp_before": hp_before, "hp_gained": 0,
                "hp_after": self.current_hp, "major_wound_recovery_required": True,
                "rule_ref": "core.combat.major_wound_recovery",
                "summary": (f"{self.investigator_id} rested {days_of_rest} day(s) with a major wound: healing "
                            "requires the weekly CON recovery roll (p.121).")})
        total_gained = self._heal(days_of_rest)
        return self._event("weekly_recovery", {
            "days_of_rest": days_of_rest, "had_major_wound": False, "hp_before": hp_before,
            "hp_gained": total_gained, "hp_after": self.current_hp,
            "summary": f"{self.investigator_id} recovered {total_gained} HP over {days_of_rest} day(s) of rest."})

    def major_wound_recovery_roll(self, *, complete_rest: bool = False, medical_care_success: bool | None = None,
                                  poor_environment: bool = False, medicine_fumbled: bool = False,
                                  roll_result: dict | None = None,
                                  attempt_elapsed_minutes: int | None = None) -> dict[str, Any]:
        bonus = int(bool(complete_rest)) + int(bool(medical_care_success))
        penalty = int(bool(poor_environment) or bool(medicine_fumbled))
        res = roll_result or self._check(self.con_value, bonus=bonus, penalty=penalty)
        outcome = res.get("outcome")
        hp_before = self.current_hp
        gained = 0
        healing_dice: dict[str, Any] | None = None
        if outcome == "extreme":
            dice = percentile.roll_expression("2D3", rng=self._rng)
            healing_dice = {"expression": "2D3", "raw": list(dice["rolls"]), "total": int(dice["total"])}
            gained = self._heal(healing_dice["total"])
            if "major_wound" in self.conditions:
                self.conditions.remove("major_wound")
        elif outcome in ("regular", "hard", "critical"):
            dice = percentile.roll_expression("1D3", rng=self._rng)
            healing_dice = {"expression": "1D3", "raw": list(dice["rolls"]), "total": int(dice["total"])}
            gained = self._heal(healing_dice["total"])
        elif outcome == "fumble":
            self._event("lasting_injury", {
                "rule_ref": "core.combat.major_wound_recovery_fumble",
                "keeper_note": ("Pick a lasting injury/complication tied to the nature of the wound and record "
                                "it in the backstory under Wounds & Scars (p.121)."),
                "summary": f"{self.investigator_id} recovery fumble: lasting injury."})
        if attempt_elapsed_minutes is not None:
            active = [row for row in self.wound_ledger if row.get("status") == "active"]
            if active:
                wound_id = max(active, key=lambda row: int(row.get("occurred_elapsed_minutes", 0)))["wound_id"]
                self.major_wound_recovery_ledger.append({"wound_id": wound_id,
                                                         "attempt_elapsed_minutes": int(attempt_elapsed_minutes)})
        return self._event("major_wound_recovery", {
            "skill": "CON", "target": self.con_value, "difficulty": "regular", "roll": res.get("roll"),
            "outcome": outcome, "bonus_dice": bonus, "penalty_dice": penalty, "complete_rest": bool(complete_rest),
            "medical_care_success": bool(medical_care_success), "poor_environment": bool(poor_environment),
            "medicine_fumbled": bool(medicine_fumbled), "hp_before": hp_before, "hp_gained": gained,
            "hp_after": self.current_hp, "healing_dice": healing_dice, "check": res,
            "rule_ref": "core.combat.major_wound_recovery",
            "summary": f"{self.investigator_id} weekly recovery CON ({outcome}): +{gained} HP."})

    # ---- daily trackers -------------------------------------------------------

    def reset_daily_treatments(self) -> None:
        self._first_aid_used_today = False
        self._first_aid_push_used_today = False
        self._medicine_used_today = False
        self._store_usage_flags()

    def reopen_subsequent_first_aid_attempt(self) -> None:
        self._first_aid_push_used_today = False
        self._store_usage_flags()

    def _load_usage_flags(self) -> None:
        flags = self._usage_records.get(self.wound_id, {}).get(self.day_id, {})
        self._first_aid_used_today = flags.get("first_aid_used") is True
        self._first_aid_push_used_today = flags.get("first_aid_push_used") is True
        self._medicine_used_today = flags.get("medicine_used") is True

    def _store_usage_flags(self) -> None:
        self._usage_records.setdefault(self.wound_id, {})[self.day_id] = {
            "first_aid_used": self._first_aid_used_today,
            "first_aid_push_used": self._first_aid_push_used_today,
            "medicine_used": self._medicine_used_today,
        }

    def set_usage_scope(self, wound_id: str, day_id: str) -> None:
        self._store_usage_flags()
        self.wound_id = wound_id
        self.day_id = day_id
        self._load_usage_flags()

    # ---- persistence ----------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {"investigator_id": self.investigator_id, "hp_max": self.hp_max, "current_hp": self.current_hp,
                "con_value": self.con_value, "conditions": list(self.conditions), "events": list(self.events),
                "healing_usage": self._healing_usage_snapshot(), "wound_ledger": list(self.wound_ledger),
                "major_wound_recovery_ledger": list(self.major_wound_recovery_ledger)}

    def _healing_usage_snapshot(self) -> dict[str, Any]:
        self._store_usage_flags()
        return {"active_wound_id": self.wound_id, "active_day_id": self.day_id,
                "records": {wound: {day: dict(flags) for day, flags in days.items()}
                            for wound, days in self._usage_records.items()}}

    def save(self, campaign_dir: Path) -> Path:
        data = read_healing_state(campaign_dir, self.investigator_id)
        data.update({"investigator_id": self.investigator_id, "current_hp": self.current_hp,
                     "conditions": list(self.conditions), "healing_usage": self._healing_usage_snapshot(),
                     "wound_ledger": list(self.wound_ledger),
                     "major_wound_recovery_ledger": list(self.major_wound_recovery_ledger)})
        return write_healing_state(campaign_dir, self.investigator_id, data)

    @classmethod
    def load(cls, tables: RuleTables, campaign_dir: Path, investigator_id: str, hp_max: int, con_value: int,
             rng: random.Random | None = None, *, current_hp: int | None = None) -> "HealingSession":
        """Reconstruct from the snapshot; `current_hp` (the sheet's value) wins when given."""
        data = read_healing_state(campaign_dir, investigator_id)
        hp = current_hp if current_hp is not None else data.get("current_hp", hp_max)
        return cls(tables, investigator_id, hp_max, con_value, rng, current_hp=hp,
                   conditions=data.get("conditions", []), healing_usage=data.get("healing_usage"),
                   wound_ledger=data.get("wound_ledger"), recovery_ledger=data.get("major_wound_recovery_ledger"))

    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"hl{self._event_counter}", **payload}
        self.events.append(ev)
        return ev


#: The rulebook's units for downtime recovery (Keeper Rulebook, Wounds and Healing, p.121):
#: regular recovery is "1 hit point per day", and the Major Wound CON roll is made "at the
#: end of each week of game time that the Major Wound box is ticked". A day is twenty-four
#: hours of the clock and a week seven of them -- not a shift, not a night's sleep. (#76: a
#: day was 480 minutes here, so one night healed three days, and the rest was cut to a week.)
DAY_MINUTES = 24 * 60
WEEK_MINUTES = 7 * DAY_MINUTES


def handle_time_trigger(tables: RuleTables, campaign_dir: Path, investigator_id: str, hp_max: int, con_value: int,
                        delta_minutes: int, *, rng: random.Random | None = None,
                        had_major_wound: bool = False) -> int:
    """Natural healing for a downtime/sleep advance; returns the HP gained.

    Six hours or more is a rest: a night's sleep is the first day of it, and under six hours
    nothing heals (the table's `REST_MINUTES` gate is the same line). Without a major wound
    the advance heals 1 HP per full day of its own length -- thirty days heal thirty days,
    not a week. With one, the CON recovery roll is made once at the end of each full week
    the box stays ticked, the days in between heal nothing, and once the box clears (an
    Extreme success, or HP back to half) the remainder of the advance heals at the regular
    rate again. Rolling the box's weekly CON after it has cleared would be a roll the book
    never asks for -- and a fumble on it would hand out a lasting injury."""
    if delta_minutes <= 0:
        return 0
    sess = HealingSession.load(tables, campaign_dir, investigator_id, hp_max, con_value, rng)
    before = sess.current_hp
    if had_major_wound and "major_wound" not in sess.conditions:
        sess.conditions.append("major_wound")
    if delta_minutes >= 360:
        remaining = delta_minutes
        while sess.has_major_wound and remaining >= WEEK_MINUTES:
            sess.major_wound_recovery_roll(complete_rest=True)
            remaining -= WEEK_MINUTES
        if not sess.has_major_wound:
            days = remaining // DAY_MINUTES
            if days == 0 and remaining >= 360:
                days = 1  # a night's sleep (six hours or more) is a day of rest
            sess.weekly_recovery(days)
    sess.reset_daily_treatments()
    sess.save(campaign_dir)
    return max(0, sess.current_hp - before)


# ---- Psychotherapy / asylum / self-help recovery (p.164-168) ---------------------

_BACKSTORY_FIELDS = ("personal_description", "ideology_beliefs", "significant_people", "meaningful_locations",
                     "treasured_possessions", "traits", "injuries_scars", "phobias_manias", "encounters")
_MONTHLY_SUCCESS_MAX = 95


class PsychotherapySession:
    """SAN recovery via treatment for one investigator; mutates `san_state` in place."""

    def __init__(self, tables: RuleTables, investigator_id: str, san_state: dict[str, Any],
                 rng: random.Random | None = None) -> None:
        self.tables = tables
        self.investigator_id = investigator_id
        self._rng = rng or random.Random()
        self.san_state = san_state
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0
        self.asylum_months_remaining = 0
        self.asylum_quality: str | None = None
        self.monthly_gains_count = 0

    @property
    def current_san(self) -> int:
        return int(self.san_state.get("current_san", 0))

    @property
    def max_san(self) -> int:
        return int(self.san_state.get("max_san", 99))

    def _set_san(self, value: int) -> int:
        new_val = max(0, min(self.max_san, int(value)))
        self.san_state["current_san"] = new_val
        return new_val

    def _event(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"event_type": type_, "eid": f"ps{self._event_counter}", **payload}
        self.events.append(ev)
        return ev

    def _check(self, target: int, **kwargs: Any) -> dict[str, Any]:
        return percentile.percentile_check(self.tables, target, rng=self._rng, **kwargs)

    def psychoanalysis(self, skill_value: int, *, difficulty: str = "regular") -> dict[str, Any]:
        res = self._check(skill_value, difficulty=difficulty)
        outcome = res.get("outcome")
        san_before = self.current_san
        recovered = 0
        expression = {"extreme": "3D3", "hard": "2D3", "regular": "1D3", "critical": "1D3"}.get(str(outcome))
        if expression:
            recovered = self._recover(int(percentile.roll_expression(expression, rng=self._rng)["total"]))
        return self._event("psychoanalysis", {
            "skill": "Psychoanalysis", "difficulty": difficulty, "outcome": outcome, "san_before": san_before,
            "san_recovered": recovered, "san_after": self.current_san,
            "summary": f"{self.investigator_id} Psychoanalysis ({difficulty}) -> {outcome}: +{recovered} SAN."})

    def monthly_treatment_roll(self, *, quality: str | None = None, rng: random.Random | None = None) -> dict[str, Any]:
        active_rng = rng or self._rng
        bonus = penalty = 0
        if quality == "good":
            bonus = 1
        elif quality == "poor":
            penalty = 1
        elif quality is not None:
            raise ValueError(f"quality must be 'good', 'poor', or None, got {quality!r}")
        res = percentile.percentile_check(self.tables, _MONTHLY_SUCCESS_MAX, bonus=bonus, penalty=penalty, rng=active_rng)
        roll = int(res.get("roll", 100))
        san_before = self.current_san
        setback = roll > _MONTHLY_SUCCESS_MAX
        if setback:
            lost = int(percentile.roll_expression("1D6", rng=active_rng)["total"])
            self._set_san(self.current_san - lost)
            san_delta = self.current_san - san_before
        else:
            gained = self._recover(int(percentile.roll_expression("1D3", rng=active_rng)["total"]))
            san_delta = gained
            if gained > 0:
                self.monthly_gains_count += 1
        return self._event("monthly_treatment", {
            "roll": roll, "bonus": int(res.get("bonus", 0)), "penalty": int(res.get("penalty", 0)),
            "quality": quality, "setback": setback, "san_before": san_before, "san_delta": san_delta,
            "san_after": self.current_san, "monthly_gains_count": self.monthly_gains_count,
            "summary": (f"{self.investigator_id} monthly treatment roll {roll}{' (setback)' if setback else ''}: "
                        f"SAN {san_before}->{self.current_san}.")})

    def confine_to_asylum(self, *, quality: str | None = None) -> dict[str, Any]:
        if quality is not None and quality not in ("good", "poor"):
            raise ValueError(f"quality must be 'good', 'poor', or None, got {quality!r}")
        months = self._rng.randint(1, 6)
        self.asylum_months_remaining = months
        self.asylum_quality = quality
        return self._event("asylum_confinement", {
            "months": months, "quality": quality,
            "summary": f"{self.investigator_id} committed to asylum for {months} month(s)" + (f" ({quality})" if quality else "") + "."})

    def resolve_asylum_release(self, psychoanalysis_skill: int = 0, *, quality: str | None = None) -> dict[str, Any]:
        del psychoanalysis_skill
        months = self.asylum_months_remaining
        self.asylum_months_remaining = 0
        monthly = self.monthly_treatment_roll(quality=quality if quality is not None else self.asylum_quality)
        monthly["event_type"] = "asylum_release"
        monthly["months_confined"] = months
        monthly["san_recovered"] = max(0, int(monthly.get("san_delta", 0)))
        monthly["summary"] = (f"{self.investigator_id} released from asylum after {months}m: monthly treatment roll "
                              f"{monthly.get('roll')}{' (setback)' if monthly.get('setback') else ''}, "
                              f"SAN {monthly.get('san_before')}->{monthly.get('san_after')}.")
        return monthly

    def cure_indefinite_check(self) -> dict[str, Any]:
        if self.monthly_gains_count < 1:
            return {"blocked": "monthly_gain_required", "monthly_gains_count": self.monthly_gains_count, "cured": False}
        res = self._check(self.current_san)
        outcome = res.get("outcome")
        cured = outcome in SUCCESS
        if cured:
            self.san_state["indefinite_insane"] = False
        return self._event("cure_indefinite", {
            "roll": res.get("roll"), "target": self.current_san, "outcome": outcome, "cured": cured,
            "monthly_gains_count": self.monthly_gains_count,
            "summary": f"{self.investigator_id} indefinite-cure check {outcome}: cured={cured}."})

    def self_help(self, *, key_connection: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(key_connection, dict):
            raise TypeError("key_connection must be a dict")
        field = key_connection.get("backstory_field")
        if field not in _BACKSTORY_FIELDS:
            raise ValueError(f"key_connection.backstory_field must be one of {_BACKSTORY_FIELDS}, got {field!r}")
        res = self._check(self.current_san)
        outcome = res.get("outcome")
        san_before = self.current_san
        payload: dict[str, Any] = {"outcome": outcome, "san_before": san_before,
                                   "key_connection": {"backstory_field": field,
                                                      "summary": str(key_connection.get("summary", ""))}}
        if outcome in SUCCESS:
            payload["san_delta"] = self._recover(int(percentile.roll_expression("1D6", rng=self._rng)["total"]))
        else:
            self._set_san(self.current_san - 1)
            payload["san_delta"] = -1
            payload["backstory_amend_required"] = {"mode": "corrupt_existing", "backstory_field": field}
        payload["san_after"] = self.current_san
        payload["summary"] = f"{self.investigator_id} self-help SAN roll {outcome}: SAN {san_before}->{self.current_san}."
        return self._event("self_help", payload)

    def _recover(self, amount: int) -> int:
        if amount <= 0:
            return 0
        before = self.current_san
        self._set_san(before + amount)
        return self.current_san - before

    def snapshot(self) -> dict[str, Any]:
        return {"investigator_id": self.investigator_id, "current_san": self.current_san, "max_san": self.max_san,
                "asylum_months_remaining": self.asylum_months_remaining, "asylum_quality": self.asylum_quality,
                "monthly_gains_count": self.monthly_gains_count, "events": list(self.events)}
