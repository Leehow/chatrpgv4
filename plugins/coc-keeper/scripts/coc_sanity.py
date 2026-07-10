#!/usr/bin/env python3
"""Structured Call of Cthulhu 7e Sanity engine — Chapter 8.

Owns the structured sanity state for one investigator across a session,
parallel to CombatSession for combat. Produces structured sanity events
and roll records. Audit verifies SAN bookkeeping, bout structure, and
insanity thresholds from state alone.

Rulebook basis: Chapter 8 (Sanity), 7e 40th Anniversary.
- SAN roll: 1D100 vs current SAN (p.166)
- SAN loss notation X/YdZ: success loses X, failure loses YdZ (p.166)
- Failed SAN roll always causes involuntary action (p.166)
- 5+ SAN lost from single source → INT roll → success = temp insane (p.167)
- Temp insanity → bout of madness: real-time (Table VII) or summary (Table VIII) (p.171)
- 1/5+ current SAN lost in one day → indefinite insanity (p.168)
- SAN = 0 → permanent insanity (p.168)
- Recovery: temporary 1D10 hours; indefinite requires treatment (p.176)
"""
from __future__ import annotations

import json
import random
import re
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
coc_rules = _load_sibling("coc_rules", "coc_rules.py")

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None  # time layer optional; sanity degrades gracefully

# Success-level ordering (same as combat).
LVL = {"fumble": 0, "failure": 1, "regular": 2, "hard": 3, "extreme": 4, "critical": 5}

# Involuntary action kinds (p.166).
INVOLUNTARY_KINDS = {
    "jump_in_fright", "cry_out", "involuntary_movement",
    "involuntary_combat_action", "freeze",
}

# Bout of madness modes.
BOUT_MODES = {"real_time", "summary"}

# Phobia / mania table loader (references/rules-json/{phobias,manias}.json).
RULES_DIR = Path(__file__).resolve().parent.parent / "references" / "rules-json"


def _load_phobia_mania_table(name: str) -> dict[str, Any]:
    """Load phobias.json or manias.json as a flat {Name: {trigger,...}} dict.

    Returns {} if the file is missing so the module degrades gracefully.
    """
    path = RULES_DIR / f"{name}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    # files store {"phobias": {...}} / {"manias": {...}}
    return data.get(name, data)


class SanitySession:
    """Structured sanity state for one investigator across a session.

    Tracks current/max SAN, sanity loss events, temporary/indefinite/permanent
    insanity status, bout of madness episodes, and recovery. Produces
    structured records for rolls.jsonl / events.jsonl and a snapshot for
    save/sanity.json (parallel to save/combat.json).

    The session is deterministic given the RNG it is handed.
    """

    def __init__(self, investigator_id: str, san_max: int, int_value: int,
                 rng: random.Random,
                 glossary: dict | None = None,
                 play_language: str = "zh-Hans",
                 campaign_dir: Path | None = None,
                 cm_value: int = 0,
                 awfulness_caps: dict[str, int] | None = None) -> None:
        self.investigator_id = investigator_id
        self.san_max = san_max  # = POW (or 99 - Cthulhu Mythos)
        self.san_current = san_max
        self.int_value = int_value
        self._rng = rng
        self._glossary = glossary or {}
        self._play_language = play_language
        # Optional campaign_dir: when set, sanity-state changes also schedule
        # / clear time-layer triggers (coc_time) and align with day anchors.
        self.campaign_dir = campaign_dir
        # Cthulhu Mythos score — drives Mythos-Hardened SAN-loss halving
        # (p.169: when CM > current SAN, SAN loss is halved, round down) and
        # the max-SAN formula (99 - CM).
        self.cm_value = int(cm_value)
        # Per-creature-type cumulative SAN loss tracking for the "getting used
        # to awfulness" cap (p.169): once the investigator has lost the
        # creature's full max possible SAN loss, further encounters with that
        # type cost nothing. Maps creature_type -> cumulative_san_lost.
        self.awfulness_caps: dict[str, int] = dict(awfulness_caps or {})

        self.events: list[dict[str, Any]] = []
        self.pending_rolls: list[dict[str, Any]] = []
        self._roll_counter = 0
        self._event_counter = 0

        # Insanity status tracking.
        self.temporary_insane: bool = False
        self.temporary_insane_remaining_hours: int = 0
        self.indefinite_insane: bool = False
        self.permanently_insane: bool = False
        # Active bout of madness (p.156-157): while a real-time bout runs,
        # the Keeper controls the investigator and no further SAN can be lost.
        self.bout_active: bool = False
        self.bout_rounds_remaining: int = 0
        self.bouts_of_madness: list[dict[str, Any]] = []
        self.daily_san_lost: int = 0  # resets at "end of day" (Keeper-defined)
        # p.156: the indefinite-insanity threshold is a fifth of *current* SAN
        # as the game day starts (re-anchored by end_day()).
        self.day_start_san: int = self.san_current
        self.involuntary_actions: list[dict[str, Any]] = []
        # Phobia / mania (p.159, p.171 bout table IX/X).
        # Set when a bout-of-madness result is 9 (phobia) or 10 (mania).
        self.phobia: str | None = None
        self.mania: str | None = None
        self.conditions: list[str] = []

    # ------------------------------------------------------------------ #
    # Core: SAN roll + loss
    # ------------------------------------------------------------------ #
    def sanity_check(self, source: str, san_loss_success: int,
                     san_loss_fail_expr: str,
                     involuntary_kind: str | None = None,
                     involuntary_summary: str = "",
                     alone: bool = False,
                     module_bout_override: dict | None = None,
                     creature_type: str | None = None) -> dict[str, Any]:
        """Resolve a SAN check per Chapter 8.

        Parameters:
            source: what caused the SAN check (e.g. "seeing a ghoul").
            san_loss_success: SAN lost on success (left of slash, e.g. 0 or 1).
            san_loss_fail_expr: SAN lost on failure (right of slash, e.g. "1D6").
            involuntary_kind: if the roll fails, the involuntary action kind
                (p.166). Required for failed rolls; None for successes.
            involuntary_summary: narrative description of the involuntary action.
            alone: if True and temp insanity triggers, use summary bout (Table VIII)
                instead of real-time (Table VII) — per p.171 for lone investigators.
            module_bout_override: module-specific bout config (e.g. The Haunting's
                Corbitt scene forces summary mode with a fixed result).
            creature_type: optional creature type key for the "getting used to
                awfulness" cap (p.169). When provided, cumulative SAN loss from
                this creature type is tracked in ``awfulness_caps`` and capped
                at the creature's max possible loss (success + max-failure).

        Returns the event record.
        """
        if self.permanently_insane:
            return self._event("sanity_check_skipped", "Investigator is permanently insane")
        if self.bout_active:
            # p.157: the mind is completely unhinged — no further SAN loss
            # while a bout of madness is being experienced.
            return self._event("sanity_check_skipped",
                               "No further SAN loss during an active bout of madness (p.157)")

        san_before = self.san_current
        res = coc_roll.percentile_check(san_before, rng=self._rng)
        roll_id = self._roll_id()

        # Determine SAN loss.
        # p.166: fumbled SAN roll = maximum possible SAN loss for this source.
        if res["outcome"] == "fumble":
            lost = self._max_dice(san_loss_fail_expr)
        elif res["outcome"] == "failure":
            lost = self._roll_dice(san_loss_fail_expr)
        else:
            lost = san_loss_success

        # Mythos-Hardened (p.169): when the investigator's Cthulhu Mythos
        # score exceeds their current SAN, SAN loss is halved (round down).
        mythos_hardened = self.cm_value > san_before
        if mythos_hardened and lost > 0:
            lost = lost // 2

        # Getting used to awfulness cap (p.169): track cumulative SAN loss per
        # creature type. Once the cumulative loss reaches the creature's max
        # possible loss (success + max-failure), further losses are zero.
        if creature_type is not None:
            max_possible = int(san_loss_success) + self._max_dice(san_loss_fail_expr)
            cumulative = self.awfulness_caps.get(creature_type, 0)
            remaining_cap = max(0, max_possible - cumulative)
            lost = min(lost, remaining_cap)
            self.awfulness_caps[creature_type] = cumulative + lost

        self.san_current = max(0, self.san_current - lost)
        self.daily_san_lost += lost

        roll_record = {
            "roll_id": roll_id,
            "actor_id": self.investigator_id,
            "skill": "SAN",
            "goal": f"withstand {source}",
            "target": san_before,
            "roll": res["roll"],
            "outcome": res["outcome"],
            "san_before": san_before,
            "san_loss": lost,
            "san_delta": -lost,
            "san_after": self.san_current,
            "mythos_hardened": mythos_hardened,
            "marker": (f"[san_check]SAN {san_loss_success}/{san_loss_fail_expr}|"
                       f"理智{san_before}:(d100->{res['roll']})->{res['outcome']}|"
                       f"{san_loss_fail_expr}->{lost if res['outcome'] in ('failure','fumble') else lost}"
                       f":sub(san,{lost})[/san_check]"),
        }
        self.pending_rolls.append(roll_record)

        event = self._event("sanity", {
            "source": source,
            "san_before": san_before,
            "san_loss": lost,
            "san_after": self.san_current,
            "roll_outcome": res["outcome"],
            "mythos_hardened": mythos_hardened,
            "creature_type": creature_type,
            "summary": f"{self.investigator_id} {source}: SAN {san_before}->{self.san_current} (lost {lost}).",
        })

        # p.166: failed SAN roll always causes involuntary action.
        if res["outcome"] in ("failure", "fumble") and involuntary_kind:
            self._apply_involuntary(involuntary_kind, involuntary_summary, source)

        # p.158: while underlying insane (temporary or indefinite, bout over)
        # ANY further SAN loss — even a single point — triggers another bout.
        underlying = (self.temporary_insane or self.indefinite_insane)
        if underlying and lost >= 1:
            self._start_bout(source, alone, module_bout_override)
        # p.167: 5+ SAN lost from single source → temporary insanity check.
        elif lost >= 5:
            self._check_temporary_insanity(source, alone, module_bout_override)

        # p.168: losing a fifth or more of *current* SAN (as of day start) in
        # one game day → indefinite insanity.
        if (self.daily_san_lost >= max(1, self.day_start_san // 5)
                and not self.indefinite_insane):
            self._trigger_indefinite_insanity()

        # p.168: SAN = 0 → permanent insanity.
        if self.san_current == 0 and not self.permanently_insane:
            self._trigger_permanent_insanity()

        return event

    def _check_temporary_insanity(self, source: str, alone: bool,
                                   module_bout_override: dict | None) -> None:
        """p.167: lose 5+ SAN from single source → INT roll.

        Counter-intuitive: INT **success** = temp insane (the investigator
        comprehends the horror); INT **failure** = memory repressed, no insanity.
        """
        int_res = coc_roll.percentile_check(self.int_value, rng=self._rng)
        int_roll_id = self._roll_id()
        self.pending_rolls.append({
            "roll_id": int_roll_id,
            "actor_id": self.investigator_id,
            "skill": "INT",
            "goal": f"determine temp insanity after {source}",
            "target": self.int_value,
            "roll": int_res["roll"],
            "outcome": int_res["outcome"],
            "marker": f"[roll]{self.investigator_id} INT{self.int_value}:(d100->{int_res['roll']})->{int_res['outcome']}[/roll]",
        })

        if int_res["outcome"] not in ("failure", "fumble"):
            # INT success → temp insane (p.167: "recognizes the full significance")
            self._trigger_temporary_insanity(source, alone, module_bout_override)

    def _trigger_temporary_insanity(self, source: str, alone: bool,
                                    module_bout_override: dict | None) -> None:
        """Trigger temporary insanity + its opening bout of madness (p.171)."""
        self.temporary_insane = True
        duration_hours = self._rng.randint(1, 10)
        self.temporary_insane_remaining_hours = duration_hours

        self._start_bout(source, alone, module_bout_override,
                         duration_hours=duration_hours)

        # p.176: temporary insanity recovers after 1D10 hours. When the time
        # layer is attached, schedule a recovery trigger due at
        # current_elapsed + remaining_hours*60. The trigger uses policy
        # auto_apply_if_safe so recovery only fires once the investigator
        # reaches a safe place (p.176 "rest in a safe place").
        self._schedule_recovery_trigger(duration_hours)

    def _start_bout(self, source: str, alone: bool,
                    module_bout_override: dict | None,
                    duration_hours: int | None = None) -> dict[str, Any]:
        """Start a bout of madness (p.156-157, tables p.171).

        Used both for the opening bout of temporary/indefinite insanity and
        for the p.158 underlying-insanity retrigger (any further SAN loss).
        Real-time bouts set ``bout_active`` (Keeper controls the investigator,
        no further SAN loss) for 1D10 rounds; summary bouts are fast-forwarded
        by the Keeper and end immediately.
        """
        if duration_hours is None:
            duration_hours = self._rng.randint(1, 10)

        # Bout mode: real-time (Table VII) if others present, summary (Table VIII) if alone.
        mode = "summary" if alone else "real_time"
        if module_bout_override and module_bout_override.get("force_mode"):
            mode = module_bout_override["force_mode"]

        bout_roll = self._rng.randint(1, 10)
        bout_result = module_bout_override.get("result_description", "") if module_bout_override else ""

        # Look up the bout result text + kind from Table VII (realtime) or
        # Table VIII (summary) per p.156/p.159.
        table_key = "summary" if mode == "summary" else "realtime"
        bout_entry = self._resolve_bout_result(table_key, bout_roll)
        bout_result_text = bout_result or bout_entry.get("result", "")
        bout_kind = bout_entry.get("kind", "")

        bout = {
            "mode": mode,
            "summary_table": "table_viii_summary" if mode == "summary" else "table_vii_realtime",
            "bout_roll": bout_roll,
            "bout_result": bout_result_text,
            "bout_kind": bout_kind,
            "duration_hours": duration_hours,
            "source": source,
        }
        if mode == "real_time":
            bout["duration_rounds"] = self._rng.randint(1, 10)
            self.bout_active = True
            self.bout_rounds_remaining = bout["duration_rounds"]
        self.bouts_of_madness.append(bout)

        # p.171 bout-of-madness table: result 9 → phobia, 10 → mania.
        # Roll on Table IX (phobias) / Table X (manias) and record the result
        # on the session + in conditions for downstream penalty-die logic (p.159).
        if bout_roll == 9:
            phobia_name = self._roll_phobia()
            if phobia_name:
                bout["phobia"] = phobia_name
        elif bout_roll == 10:
            mania_name = self._roll_mania()
            if mania_name:
                bout["mania"] = mania_name

        self._event("bout_of_madness", {
            **bout,
            "summary": f"{self.investigator_id} bout of madness ({mode}): roll {bout_roll}, "
                       f"duration {duration_hours}h. {bout_result_text}",
        })
        return bout

    def tick_bout_round(self) -> dict[str, Any]:
        """Advance a real-time bout by one combat round (p.157: 1D10 rounds).

        Returns a status dict; when the last round elapses the bout ends and
        control returns to the player (underlying insanity continues).
        """
        if not self.bout_active:
            return {"bout_active": False, "bout_rounds_remaining": 0}
        self.bout_rounds_remaining = max(0, self.bout_rounds_remaining - 1)
        if self.bout_rounds_remaining == 0:
            self.end_bout()
        return {"bout_active": self.bout_active,
                "bout_rounds_remaining": self.bout_rounds_remaining}

    def end_bout(self) -> None:
        """End the active bout: control returns to the player; the fragile
        underlying-insanity phase continues (p.158)."""
        if not self.bout_active:
            return
        self.bout_active = False
        self.bout_rounds_remaining = 0
        self._event("bout_ended", {
            "summary": (f"{self.investigator_id} bout of madness ends; control "
                        "returns to the player (underlying insanity continues)."),
        })

    def _trigger_indefinite_insanity(self) -> None:
        """p.168: 1/5+ SAN lost in one day → indefinite insanity.

        When the time layer is attached, also schedules a weekly
        ``apply_psychoanalysis_treatment`` trigger (p.164) so the time-trigger
        dispatch can attempt SAN recovery via PsychotherapySession.
        """
        self.indefinite_insane = True
        self._event("indefinite_insanity", {
            "summary": f"{self.investigator_id} lost >=1/5 SAN in one day → indefinite insanity.",
            "daily_san_lost": self.daily_san_lost,
            "threshold": max(1, self.day_start_san // 5),
        })
        self._schedule_weekly_treatment_trigger()

    def _schedule_weekly_treatment_trigger(self) -> str | None:
        """Schedule a weekly Psychoanalysis treatment trigger (p.164).

        Due at current_elapsed + 7 days, handler
        ``apply_psychoanalysis_treatment``, policy ``auto_apply_if_safe`` so
        treatment only fires once the investigator reaches a safe place. The
        handler dispatch in ``coc_time.process_due_triggers`` rebuilds a
        PsychotherapySession and runs ``psychoanalysis()``. Returns trigger_id,
        or None if the time layer is not attached.
        """
        if not self._time_layer_ready():
            return None
        state = coc_time.read_time_state(self.campaign_dir)  # type: ignore[union-attr]
        if not state:
            coc_time.initialize_time_state(self.campaign_dir)  # type: ignore[union-attr]
            state = coc_time.read_time_state(self.campaign_dir)  # type: ignore[union-attr]
        now = int(state.get("clock", {}).get("elapsed_minutes", 0))
        due = now + 7 * 24 * 60  # one week
        trig_id = coc_time.schedule_trigger(self.campaign_dir, {  # type: ignore[union-attr]
            "kind": "treatment",
            "scope": "investigator",
            "target_id": self.investigator_id,
            "due_elapsed_minutes": due,
            "policy": "auto_apply_if_safe",
            "handler": "apply_psychoanalysis_treatment",
            "payload": {"condition": "indefinite_insane"},
        })
        self._event("treatment_trigger_scheduled", {
            "trigger_id": trig_id,
            "due_elapsed_minutes": due,
            "summary": (f"{self.investigator_id} weekly Psychoanalysis treatment "
                        f"scheduled for elapsed>{due} (auto_apply_if_safe)."),
        })
        return trig_id

    def _trigger_permanent_insanity(self) -> None:
        """p.168: SAN = 0 → permanent insanity (character retired)."""
        self.permanently_insane = True
        self._event("permanent_insanity", {
            "summary": f"{self.investigator_id} SAN reached 0 → permanent insanity. Character retired.",
        })

    def _apply_involuntary(self, kind: str, summary: str, source: str) -> None:
        """p.166: failed SAN roll always causes loss of self-control."""
        if kind not in INVOLUNTARY_KINDS:
            kind = "freeze"  # safe default
        action = {"kind": kind, "summary": summary or f"{kind} from {source}",
                  "source": source, "rule_ref": "core.sanity.failure_involuntary_action"}
        self.involuntary_actions.append(action)
        self._event("involuntary_action", {**action,
            "summary": f"{self.investigator_id} {kind}: {summary or source}"})

    # ------------------------------------------------------------------ #
    # Bout-of-madness table resolution (p.156 Table VII / p.159 Table VIII)
    # ------------------------------------------------------------------ #
    def _resolve_bout_result(self, table_key: str, bout_roll: int) -> dict[str, Any]:
        """Look up a bout-of-madness result by d10 roll.

        ``table_key`` is "realtime" (Table VII) or "summary" (Table VIII).
        Returns {"result": <text>, "kind": <kind>} for the row whose
        ``d10_roll`` matches ``bout_roll``. Returns an empty dict if the
        table is unavailable so the bout still resolves gracefully.
        """
        try:
            if table_key == "summary":
                rows = coc_rules.bout_summary_table()
            else:
                rows = coc_rules.bout_realtime_table()
        except Exception:
            return {}
        for row in rows or []:
            if int(row.get("d10_roll", 0)) == int(bout_roll):
                return {"result": str(row.get("result", "")),
                        "kind": str(row.get("kind", ""))}
        return {}

    # ------------------------------------------------------------------ #
    # Phobia / mania (p.159, p.171)
    # ------------------------------------------------------------------ #
    def _roll_phobia(self) -> str | None:
        """Roll 1D100 on Table IX (phobias) and record the result (p.171).

        Sets ``self.phobia`` and adds ``"phobia:<name>"`` to conditions.
        Returns the phobia name, or None if the phobia table is unavailable.
        """
        table = _load_phobia_mania_table("phobias")
        if not table:
            return None
        names = list(table.keys())
        roll = self._rng.randint(1, 100)
        idx = min(roll - 1, len(names) - 1)
        name = names[idx]
        self.phobia = name
        cond = f"phobia:{name}"
        if cond not in self.conditions:
            self.conditions.append(cond)
        self._event("phobia_gained", {
            "phobia": name, "roll": roll,
            "trigger": table.get(name, {}).get("trigger", ""),
            "summary": f"{self.investigator_id} developed phobia: {name} (Table IX roll {roll}).",
        })
        return name

    def _roll_mania(self) -> str | None:
        """Roll 1D100 on Table X (manias) and record the result (p.171).

        Sets ``self.mania`` and adds ``"mania:<name>"`` to conditions.
        Returns the mania name, or None if the mania table is unavailable.
        """
        table = _load_phobia_mania_table("manias")
        if not table:
            return None
        names = list(table.keys())
        roll = self._rng.randint(1, 100)
        idx = min(roll - 1, len(names) - 1)
        name = names[idx]
        self.mania = name
        cond = f"mania:{name}"
        if cond not in self.conditions:
            self.conditions.append(cond)
        self._event("mania_gained", {
            "mania": name, "roll": roll,
            "trigger": table.get(name, {}).get("trigger", ""),
            "summary": f"{self.investigator_id} developed mania: {name} (Table X roll {roll}).",
        })
        return name

    @property
    def is_insane(self) -> bool:
        """True if the investigator is currently in any insanity state."""
        return self.temporary_insane or self.indefinite_insane or self.permanently_insane

    def penalty_die_for_exposure(self, *, phobia_source: str | None = None,
                                 mania_source: str | None = None) -> int:
        """Penalty dice applied when an insane investigator is exposed to a
        phobia or mania source (p.159).

        - Phobia exposure while insane: 1 penalty die to all non-SAN rolls.
        - Mania exposure while insane: 1 penalty die until the mania is indulged.

        ``phobia_source``/``mania_source`` are the name (or substring) of the
        phobia/mania being confronted. Returns 0 or 1 (penalty dice count).
        """
        if not self.is_insane:
            return 0
        penalty = 0
        if phobia_source and self.phobia and phobia_source.lower() in self.phobia.lower():
            penalty += 1
        if mania_source and self.mania and mania_source.lower() in self.mania.lower():
            penalty += 1
        return penalty

    # ------------------------------------------------------------------ #
    # coc_time integration: schedule / clear recovery triggers
    # ------------------------------------------------------------------ #
    def _time_layer_ready(self) -> bool:
        """True if both the time layer and a campaign_dir are attached."""
        return coc_time is not None and self.campaign_dir is not None

    def _schedule_recovery_trigger(self, remaining_hours: int) -> str | None:
        """Schedule a coc_time trigger to recover temporary insanity.

        Due at current_elapsed + remaining_hours*60 minutes, handler
        ``recover_temporary_insanity``, policy ``auto_apply_if_safe`` so
        recovery only fires once the investigator is in a safe place (p.176).
        Returns the trigger_id, or None if the time layer is not attached.
        """
        if not self._time_layer_ready():
            return None
        # Ensure time-state is initialized so elapsed can be read.
        state = coc_time.read_time_state(self.campaign_dir)  # type: ignore[union-attr]
        if not state:
            coc_time.initialize_time_state(self.campaign_dir)  # type: ignore[union-attr]
            state = coc_time.read_time_state(self.campaign_dir)  # type: ignore[union-attr]
        now = int(state.get("clock", {}).get("elapsed_minutes", 0))
        due = now + max(0, int(remaining_hours)) * 60
        trig_id = coc_time.schedule_trigger(self.campaign_dir, {  # type: ignore[union-attr]
            "kind": "condition_expiry",
            "scope": "investigator",
            "target_id": self.investigator_id,
            "due_elapsed_minutes": due,
            "policy": "auto_apply_if_safe",
            "handler": "recover_temporary_insanity",
            "payload": {"condition": "temporary_insane"},
        })
        self._event("recovery_trigger_scheduled", {
            "trigger_id": trig_id,
            "due_elapsed_minutes": due,
            "remaining_hours": remaining_hours,
            "summary": (f"{self.investigator_id} temporary-insanity recovery "
                        f"scheduled for elapsed>{due} (auto_apply_if_safe)."),
        })
        return trig_id

    # ------------------------------------------------------------------ #
    # Recovery
    # ------------------------------------------------------------------ #
    def recover_temporary(self) -> bool:
        """p.176: temporary insanity ends after 1D10 hours.

        Clears the condition and emits a recovery event. When the time layer
        is attached, any pending recovery trigger is left to fire normally
        (the caller/time layer marks safe rest); this method only resolves
        the in-session insanity state.
        """
        if self.temporary_insane:
            self.temporary_insane = False
            self.temporary_insane_remaining_hours = 0
            self._event("sanity_recovered", {
                "summary": f"{self.investigator_id} recovered from temporary insanity.",
            })
            return True
        return False

    def end_day(self) -> None:
        """Reset daily SAN loss counter (Keeper defines when a 'day' ends).

        When the time layer is attached, this also records the day boundary
        in the investigator's sanity period (the elapsed anchor used to
        compute 1/5-SAN-per-day indefinite-insanity thresholds).
        """
        self.daily_san_lost = 0
        self.day_start_san = self.san_current  # re-anchor threshold (p.156)
        if not self._time_layer_ready():
            return
        state = coc_time.read_time_state(self.campaign_dir)  # type: ignore[union-attr]
        if not state:
            return
        now = int(state.get("clock", {}).get("elapsed_minutes", 0))
        periods = state.get("sanity_periods", {})
        key = self.investigator_id
        period = periods.get(key, {})
        period["day_started_elapsed"] = now
        periods[key] = period
        state["sanity_periods"] = periods
        # Persist back through the time layer's own write path.
        import json as _json
        path = self.campaign_dir / "save" / "time-state.json"  # type: ignore[union-attr]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")

    def gain_san(self, amount: int, source: str = "reward") -> None:
        """Increase current SAN (e.g. module conclusion reward). Cannot exceed san_max."""
        before = self.san_current
        self.san_current = min(self.san_max, self.san_current + amount)
        actual = self.san_current - before
        if actual > 0:
            roll_id = self._roll_id()
            self.pending_rolls.append({
                "roll_id": roll_id, "actor_id": self.investigator_id,
                "skill": "SAN Reward", "goal": source,
                "die": f"{amount}", "roll": amount,
                "san_before": before, "san_delta": actual, "san_after": self.san_current,
                "outcome": "sanity_reward",
                "marker": f"[roll]SAN reward +{actual}: {before}->{self.san_current}[/roll]",
            })
            self._event("sanity_gain", {
                "amount": actual, "source": source,
                "san_before": before, "san_after": self.san_current,
                "summary": f"{self.investigator_id} gained {actual} SAN ({source}): {before}->{self.san_current}.",
            })

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "investigator_id": self.investigator_id,
            "san_max": self.san_max,
            "san_current": self.san_current,
            "cm_value": self.cm_value,
            "awfulness_caps": dict(self.awfulness_caps),
            "temporary_insane": self.temporary_insane,
            "temporary_insane_remaining_hours": self.temporary_insane_remaining_hours,
            "indefinite_insane": self.indefinite_insane,
            "permanently_insane": self.permanently_insane,
            "bout_active": self.bout_active,
            "bout_rounds_remaining": self.bout_rounds_remaining,
            "daily_san_lost": self.daily_san_lost,
            "day_start_san": self.day_start_san,
            "bouts_of_madness": list(self.bouts_of_madness),
            "involuntary_actions": list(self.involuntary_actions),
            "phobia": self.phobia,
            "mania": self.mania,
            "conditions": list(self.conditions),
            "events": list(self.events),
        }

    def save(self, campaign_dir: Path) -> Path:
        save_dir = campaign_dir / "save"
        save_dir.mkdir(parents=True, exist_ok=True)
        path = save_dir / "sanity.json"
        path.write_text(json.dumps(self.snapshot(), ensure_ascii=False, indent=2),
                        encoding="utf-8")
        # Mirror the player-facing fields the Story Director reads into
        # investigator-state, so build_director_context can see the live SAN
        # and indefinite-insanity flag without parsing the sanity snapshot.
        self._sync_to_investigator_state(campaign_dir)
        return path

    def _sync_to_investigator_state(self, campaign_dir: Path) -> None:
        """Merge ``current_san`` + ``indefinite_insane`` into investigator-state.

        The director reads these top-level fields from
        ``save/investigator-state/<id>.json``; this keeps them in sync with the
        authoritative sanity snapshot. Failures are non-fatal (the sanity.json
        snapshot remains the source of truth).
        """
        inv_path = campaign_dir / "save" / "investigator-state" / f"{self.investigator_id}.json"
        try:
            data = json.loads(inv_path.read_text(encoding="utf-8")) if inv_path.exists() else {}
            data["current_san"] = int(self.san_current)
            data["indefinite_insane"] = bool(self.indefinite_insane)
            data["bout_active"] = bool(self.bout_active)
            inv_path.parent.mkdir(parents=True, exist_ok=True)
            inv_path.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                                encoding="utf-8")
        except (OSError, ValueError):
            pass

    @classmethod
    def load(cls, campaign_dir: Path, investigator_id: str,
             int_value: int = 50, rng: random.Random | None = None,
             cm_value: int = 0) -> "SanitySession":
        """Reconstruct a SanitySession from the saved ``save/sanity.json`` snapshot.

        Mirrors ``HealingSession.load``. If no snapshot exists, a fresh session
        is returned. Used by the time-trigger handler dispatch (see
        ``coc_time.process_due_triggers``) so the ``recover_temporary_insanity``
        handler can rebuild the session, run ``recover_temporary()``, and save.
        """
        save_path = campaign_dir / "save" / "sanity.json"
        if not save_path.exists():
            sess = cls(investigator_id, san_max=99, int_value=int_value,
                       rng=rng or random.Random(), cm_value=cm_value,
                       campaign_dir=campaign_dir)
            return sess
        snap = json.loads(save_path.read_text(encoding="utf-8"))
        sess = cls(
            investigator_id,
            san_max=int(snap.get("san_max", 99)),
            int_value=int_value,
            rng=rng or random.Random(),
            cm_value=int(snap.get("cm_value", cm_value)),
            campaign_dir=campaign_dir,
        )
        sess.san_current = int(snap.get("san_current", sess.san_max))
        sess.temporary_insane = bool(snap.get("temporary_insane", False))
        sess.temporary_insane_remaining_hours = int(
            snap.get("temporary_insane_remaining_hours", 0))
        sess.indefinite_insane = bool(snap.get("indefinite_insane", False))
        sess.permanently_insane = bool(snap.get("permanently_insane", False))
        sess.bout_active = bool(snap.get("bout_active", False))
        sess.bout_rounds_remaining = int(snap.get("bout_rounds_remaining", 0))
        sess.daily_san_lost = int(snap.get("daily_san_lost", 0))
        sess.day_start_san = int(snap.get("day_start_san", sess.san_current))
        saved_events = snap.get("events") or []
        sess.events = list(saved_events)
        sess._event_counter = len(saved_events)
        return sess

    def drain_pending(self) -> list[dict]:
        rolls = self.pending_rolls
        self.pending_rolls = []
        return rolls

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _roll_id(self) -> str:
        self._roll_counter += 1
        return f"sr{self._roll_counter}"

    def _event(self, type_: str, payload: dict[str, Any] | str = None) -> dict[str, Any]:
        self._event_counter += 1
        if isinstance(payload, str):
            payload = {"summary": payload}
        event = {"event_id": f"se{self._event_counter}", "type": type_, "payload": payload}
        self.events.append(event)
        return event

    def _roll_dice(self, expr: str) -> int:
        """Roll a dice expression like '1D6', '1D4+1', '2D10+1'."""
        m = re.fullmatch(r"(\d+)D(\d+)(\+(\d+))?", expr.strip())
        if m:
            n, sides = int(m.group(1)), int(m.group(2))
            mod = int(m.group(4)) if m.group(4) else 0
            return sum(self._rng.randint(1, sides) for _ in range(n)) + mod
        try:
            return int(expr)
        except ValueError:
            return 1  # safe fallback

    def _max_dice(self, expr: str) -> int:
        """Maximum possible value of a dice expression. Used for fumbled SAN rolls
        (p.166: 'losing the maximum Sanity points for that situation')."""
        m = re.fullmatch(r"(\d+)D(\d+)(\+(\d+))?", expr.strip())
        if m:
            n, sides = int(m.group(1)), int(m.group(2))
            mod = int(m.group(4)) if m.group(4) else 0
            return n * sides + mod
        try:
            return int(expr)
        except ValueError:
            return 1
