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

# Success-level ordering (same as combat).
LVL = {"fumble": 0, "failure": 1, "regular": 2, "hard": 3, "extreme": 4, "critical": 5}

# Involuntary action kinds (p.166).
INVOLUNTARY_KINDS = {
    "jump_in_fright", "cry_out", "involuntary_movement",
    "involuntary_combat_action", "freeze",
}

# Bout of madness modes.
BOUT_MODES = {"real_time", "summary"}


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
                 play_language: str = "zh-Hans") -> None:
        self.investigator_id = investigator_id
        self.san_max = san_max  # = POW (or 99 - Cthulhu Mythos)
        self.san_current = san_max
        self.int_value = int_value
        self._rng = rng
        self._glossary = glossary or {}
        self._play_language = play_language

        self.events: list[dict[str, Any]] = []
        self.pending_rolls: list[dict[str, Any]] = []
        self._roll_counter = 0
        self._event_counter = 0

        # Insanity status tracking.
        self.temporary_insane: bool = False
        self.temporary_insane_remaining_hours: int = 0
        self.indefinite_insane: bool = False
        self.permanently_insane: bool = False
        self.bouts_of_madness: list[dict[str, Any]] = []
        self.daily_san_lost: int = 0  # resets at "end of day" (Keeper-defined)
        self.involuntary_actions: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ #
    # Core: SAN roll + loss
    # ------------------------------------------------------------------ #
    def sanity_check(self, source: str, san_loss_success: int,
                     san_loss_fail_expr: str,
                     involuntary_kind: str | None = None,
                     involuntary_summary: str = "",
                     alone: bool = False,
                     module_bout_override: dict | None = None) -> dict[str, Any]:
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

        Returns the event record.
        """
        if self.permanently_insane:
            return self._event("sanity_check_skipped", "Investigator is permanently insane")

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
            "summary": f"{self.investigator_id} {source}: SAN {san_before}->{self.san_current} (lost {lost}).",
        })

        # p.166: failed SAN roll always causes involuntary action.
        if res["outcome"] in ("failure", "fumble") and involuntary_kind:
            self._apply_involuntary(involuntary_kind, involuntary_summary, source)

        # p.167: 5+ SAN lost from single source → temporary insanity check.
        if lost >= 5:
            self._check_temporary_insanity(source, alone, module_bout_override)

        # p.168: 1/5+ current SAN lost in one day → indefinite insanity.
        if self.daily_san_lost >= self.san_max // 5 and not self.indefinite_insane:
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
        """Trigger bout of madness (p.171)."""
        self.temporary_insane = True
        duration_hours = self._rng.randint(1, 10)
        self.temporary_insane_remaining_hours = duration_hours

        # Bout mode: real-time (Table VII) if others present, summary (Table VIII) if alone.
        mode = "summary" if alone else "real_time"
        if module_bout_override and module_bout_override.get("force_mode"):
            mode = module_bout_override["force_mode"]

        bout_roll = self._rng.randint(1, 10)
        bout_result = module_bout_override.get("result_description", "") if module_bout_override else ""

        bout = {
            "mode": mode,
            "summary_table": "table_viii_summary" if mode == "summary" else "table_vii_realtime",
            "bout_roll": bout_roll,
            "duration_hours": duration_hours,
            "source": source,
        }
        if mode == "real_time":
            bout["duration_rounds"] = self._rng.randint(1, 10)
        self.bouts_of_madness.append(bout)

        self._event("bout_of_madness", {
            **bout,
            "summary": f"{self.investigator_id} bout of madness ({mode}): roll {bout_roll}, "
                       f"duration {duration_hours}h. {bout_result}",
        })

    def _trigger_indefinite_insanity(self) -> None:
        """p.168: 1/5+ SAN lost in one day → indefinite insanity."""
        self.indefinite_insane = True
        self._event("indefinite_insanity", {
            "summary": f"{self.investigator_id} lost >=1/5 SAN in one day → indefinite insanity.",
            "daily_san_lost": self.daily_san_lost,
            "threshold": self.san_max // 5,
        })

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
    # Recovery
    # ------------------------------------------------------------------ #
    def recover_temporary(self) -> bool:
        """p.176: temporary insanity ends after 1D10 hours."""
        if self.temporary_insane:
            self.temporary_insane = False
            self.temporary_insane_remaining_hours = 0
            self._event("sanity_recovered", {
                "summary": f"{self.investigator_id} recovered from temporary insanity.",
            })
            return True
        return False

    def end_day(self) -> None:
        """Reset daily SAN loss counter (Keeper defines when a 'day' ends)."""
        self.daily_san_lost = 0

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
            "temporary_insane": self.temporary_insane,
            "temporary_insane_remaining_hours": self.temporary_insane_remaining_hours,
            "indefinite_insane": self.indefinite_insane,
            "permanently_insane": self.permanently_insane,
            "daily_san_lost": self.daily_san_lost,
            "bouts_of_madness": list(self.bouts_of_madness),
            "involuntary_actions": list(self.involuntary_actions),
            "events": list(self.events),
        }

    def save(self, campaign_dir: Path) -> Path:
        save_dir = campaign_dir / "save"
        save_dir.mkdir(parents=True, exist_ok=True)
        path = save_dir / "sanity.json"
        path.write_text(json.dumps(self.snapshot(), ensure_ascii=False, indent=2),
                        encoding="utf-8")
        return path

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
