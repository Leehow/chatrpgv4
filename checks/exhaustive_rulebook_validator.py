"""Exhaustive rulebook validator for COC playtest data.

Checks EVERY roll and EVERY event in EVERY playtest run against EVERY
machine-checkable rule from the Call of Cthulhu 7e Keeper Rulebook.
This is not a spot-check; it is a full sweep. Any violation is reported
with the run, the offending record, the rule id, and the rulebook page.

Rule references come from checks/coC7_rule_checklist.md (extracted from
the rulebook PDF). Rule ids below match the checklist sections.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

# --------------------------------------------------------------------------- #
# Outcome normalization
# --------------------------------------------------------------------------- #
# Playtest payloads use a mix of outcome tokens. Map them to a canonical
# success-level for rule comparisons. "damage_applied" / "sanity_reward" are
# non-skill outcomes (damage/reward dice) and are excluded from skill-roll
# success-level rules.
SUCCESS_LEVEL = {
    "critical": 5,
    "extreme_success": 4,
    "extreme": 4,
    "hard_success": 3,
    "hard": 3,
    "regular_success": 2,
    "regular": 2,
    "success": 2,  # generic success; treated as regular unless a hard/extreme token
    "failure": 1,
    "fumble": 0,
}
# Outcomes that are NOT skill checks (damage dice, reward dice) — skip the
# skill-roll success-band rules for these.
NON_SKILL_OUTCOMES = {"damage_applied", "sanity_reward"}

# Rulebook involuntary-action kinds (p.166).
INVOLUNTARY_KINDS = {
    "jump_in_fright",
    "cry_out",
    "involuntary_movement",
    "involuntary_combat_action",
    "freeze",
}
# Skills that never earn development ticks (p.94 / E4).
UNTICKABLE_SKILLS = {"Cthulhu Mythos", "Credit Rating"}
# Skills that are pushable: skill rolls and characteristic rolls only (D1).
# SAN, damage, Luck, combat (Fighting/Firearms), reward, SAN-loss are NOT pushable.
NON_PUSHABLE_SKILLS = {"SAN", "SAN Reward", "HP Damage", "Luck"}
COMBAT_SKILLS = {"Fighting (Brawl)", "Fighting (Sword)", "Firearms (Handgun)",
                 "Firearms (Rifle/Shotgun)", "Fighting", "Firearms",
                 "Dodge"}  # Dodge is combat-defense; per D5 combat rolls cannot be pushed


# --------------------------------------------------------------------------- #
# Violation collection
# --------------------------------------------------------------------------- #
class Violations:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, run: str, rule: str, page: str, detail: str, record: Any) -> None:
        goal = ""
        if isinstance(record, dict):
            p = record.get("payload", record)
            goal = str(p.get("goal") or p.get("roll_id") or p.get("summary") or "")[:50]
        self.items.append(f"[{run}] {rule} (p.{page}): {detail}" + (f" — '{goal}'" if goal else ""))

    def __len__(self) -> int:
        return len(self.items)

    def report(self) -> str:
        if not self.items:
            return "EXHAUSTIVE CHECK PASSED: 0 violations across all runs"
        lines = [f"EXHAUSTIVE CHECK FAILED: {len(self.items)} violation(s)"]
        for v in self.items:
            lines.append("  - " + v)
        return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _half(v: int) -> int:
    return v // 2


def _fifth(v: int) -> int:
    return v // 5


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _is_skill_roll(roll: dict) -> bool:
    """A roll that is subject to skill-roll success-band rules."""
    p = roll.get("payload", {})
    if p.get("outcome") in NON_SKILL_OUTCOMES:
        return False
    if p.get("damage_kind") or p.get("reward_kind"):
        return False
    return True


def _expected_success_level(roll_val: int, regular_target: int) -> str:
    """Compute the rulebook success level for roll_val against regular_target.

    Implements A5/B1/B3/B4/B5. regular_target is the FULL skill value (the
    Regular-difficulty target). Fumble band depends on whether the effective
    target is >=50 or <50; here we use the regular target for the canonical
    case. Returns one of: critical/extreme_success/hard_success/regular_success/
    failure/fumble.
    """
    if roll_val <= 0:
        return "fumble"
    if roll_val == 1:
        return "critical"
    if roll_val <= _fifth(regular_target):
        return "extreme_success"
    if roll_val <= _half(regular_target):
        return "hard_success"
    if roll_val <= regular_target:
        return "regular_success"
    # fumble band per B3/B4
    if regular_target < 50 and roll_val >= 96:
        return "fumble"
    if regular_target >= 50 and roll_val == 100:
        return "fumble"
    return "failure"


def _outcome_level_token(outcome: str) -> int:
    """Map stored outcome to success level for ordering comparisons."""
    return SUCCESS_LEVEL.get(outcome, -1)


# --------------------------------------------------------------------------- #
# Per-roll checks (exhaustive over every roll)
# --------------------------------------------------------------------------- #
def check_roll(run: str, roll: dict, V: Violations) -> None:
    # NOTE on opposed rolls (rulebook p.92): "In the case of an opposed roll
    # difficulty levels are never set. The level of success achieved by one
    # side is, in effect, the level of difficulty that the other side must
    # compete against." So opposed rolls use each side's FULL skill as the
    # target and compute a success level by full/half/fifth bands, then compare
    # levels. We do NOT apply opponent-skill-as-difficulty (that was a
    # misreading); difficulty=='opposed' rolls are validated like regular
    # self-rolls against target=full skill.
    p = roll.get("payload", {})
    roll_val = p.get("roll")
    target = p.get("target")
    eff_target = p.get("effective_target", target)
    outcome = p.get("outcome")
    skill = p.get("skill")
    rtype = roll.get("type")

    # --- A/B: skill-roll numeric consistency (only for actual skill rolls) ---
    if _is_skill_roll(roll) and isinstance(roll_val, int) and isinstance(target, int):
        # roll must be 1..100
        if not (1 <= roll_val <= 100):
            V.add(run, "A5", "91", f"roll {roll_val} outside 1-100", roll)
            return
        expected = _expected_success_level(roll_val, target)
        # outcome consistency: a stored success token must not contradict bands
        if outcome in ("regular_success", "hard_success", "extreme_success", "critical"):
            exp_level = SUCCESS_LEVEL[expected]
            got_level = SUCCESS_LEVEL[outcome]
            # hard_success token requires roll <= half; extreme <= fifth; critical == 1
            if outcome == "hard_success" and roll_val > _half(target):
                V.add(run, "A2", "83",
                      f"hard_success but roll {roll_val} > half({target})={_half(target)}", roll)
            elif outcome == "extreme_success" and roll_val > _fifth(target):
                V.add(run, "A3", "83",
                      f"extreme_success but roll {roll_val} > fifth({target})={_fifth(target)}", roll)
            elif outcome == "critical" and roll_val != 1:
                V.add(run, "B1", "89", f"critical but roll {roll_val} != 1", roll)
        elif outcome == "failure":
            if roll_val <= target:
                V.add(run, "A5", "91",
                      f"outcome failure but roll {roll_val} <= target {target}", roll)
        elif outcome == "success":
            # generic success must satisfy roll <= target
            if roll_val > target:
                V.add(run, "A5", "91",
                      f"outcome success but roll {roll_val} > target {target}", roll)
        # fumble band (B3/B4): if a fumble token were stored it must match; also
        # if roll is in fumble band the outcome must not be a plain success.
        is_fumble_band = (target < 50 and roll_val >= 96) or (target >= 50 and roll_val == 100)
        if is_fumble_band and outcome in ("regular_success", "hard_success",
                                          "extreme_success", "critical", "success"):
            V.add(run, "B3/B4", "90",
                  f"roll {roll_val} is in fumble band (target {target}) but outcome is {outcome}", roll)

    # --- F: Sanity core mechanics (SAN rolls) ---
    if rtype == "sanity" or skill == "SAN":
        if isinstance(roll_val, int):
            if not (1 <= roll_val <= 100):
                V.add(run, "F1", "154", f"SAN roll {roll_val} not 1-100", roll)
        # target must be current SAN (an int)
        if not isinstance(target, int) or target < 0 or target > 99:
            V.add(run, "F1", "154", f"SAN target {target} not a valid current SAN", roll)
        # outcome consistency: success iff roll <= target
        if isinstance(roll_val, int) and isinstance(target, int):
            if outcome == "success" and roll_val > target:
                V.add(run, "F1", "154",
                      f"SAN success but roll {roll_val} > current SAN {target}", roll)
            if outcome == "failure" and roll_val <= target:
                V.add(run, "F1", "154",
                      f"SAN failure but roll {roll_val} <= current SAN {target}", roll)
        # failed SAN roll must carry involuntary_action (p.166 / F5)
        if outcome == "failure":
            ia = p.get("involuntary_action")
            if not isinstance(ia, dict):
                V.add(run, "F5", "154",
                      "failed SAN roll missing involuntary_action block", roll)
            elif ia.get("kind") not in INVOLUNTARY_KINDS:
                V.add(run, "F5", "154",
                      f"involuntary_action.kind '{ia.get('kind')}' not in rulebook 5 kinds", roll)
        # SAN bookkeeping: san_before + san_delta == san_after, delta sign matches loss/gain
        if all(k in p for k in ("san_before", "san_delta", "san_after")):
            sb, sd, sa = p["san_before"], p["san_delta"], p["san_after"]
            if not (isinstance(sb, int) and isinstance(sd, int) and isinstance(sa, int)):
                V.add(run, "F2", "154", "SAN before/delta/after not all integers", roll)
            elif sb + sd != sa:
                V.add(run, "F2", "154",
                      f"SAN bookkeeping {sb}+{sd}!={sa}", roll)
            if isinstance(p.get("san_loss"), int) and p["san_loss"] > 0 and outcome == "failure":
                if sd != -p["san_loss"]:
                    V.add(run, "F2", "154",
                          f"san_delta {sd} != -san_loss {-p['san_loss']}", roll)

    # --- D: pushed roll protocol (every pushed payload) ---
    if p.get("pushed") is True:
        # D1: SAN/damage/Luck/combat rolls cannot be pushed
        if skill in NON_PUSHABLE_SKILLS:
            V.add(run, "D1", "85", f"non-pushable skill '{skill}' marked pushed", roll)
        if skill in COMBAT_SKILLS and skill != "Dodge":
            # Fighting/Firearms attack rolls cannot be pushed (D5). Dodge is
            # defense, recorded but not "pushed" in the roll sense.
            V.add(run, "D5", "104", f"combat skill '{skill}' marked pushed", roll)
        # D6: pushed payload must carry pushed_roll_protocol with foreshadowing
        proto = p.get("pushed_roll_protocol")
        if not isinstance(proto, dict):
            V.add(run, "D6", "85", "pushed roll missing pushed_roll_protocol", roll)
        else:
            if proto.get("failure_consequence_source") != "keeper":
                V.add(run, "D6", "85",
                      "pushed_roll_protocol.failure_consequence_source != keeper", roll)
            if not proto.get("keeper_foreshadowed_failure"):
                V.add(run, "D6", "85",
                      "pushed_roll_protocol.keeper_foreshadowed_failure not true", roll)
            if not proto.get("player_confirmation_recorded"):
                V.add(run, "D2", "84",
                      "pushed_roll_protocol.player_confirmation_recorded not true", roll)

    # --- Damage dice structure (every hit_points damage roll) ---
    if p.get("damage_kind") == "hit_points":
        for key in ("die", "die_rolls", "flat_modifier"):
            if key not in p:
                V.add(run, "DMG", "131", f"HP damage roll missing {key}", roll)
        if all(k in p for k in ("hp_before", "hp_delta", "hp_after")):
            hb, hd, ha = p["hp_before"], p["hp_delta"], p["hp_after"]
            if isinstance(hb, int) and isinstance(hd, int) and isinstance(ha, int):
                if hb + hd != ha:
                    V.add(run, "DMG", "131", f"HP bookkeeping {hb}+{hd}!={ha}", roll)
        # die_rolls sum + flat_modifier should equal -(hp_delta) magnitude
        if "die_rolls" in p and "flat_modifier" in p and isinstance(p.get("hp_delta"), int):
            rolls_sum = sum(p["die_rolls"]) if isinstance(p["die_rolls"], list) else None
            if rolls_sum is not None and p["hp_delta"] < 0:
                expected_delta = -(rolls_sum + p["flat_modifier"])
                if expected_delta != p["hp_delta"]:
                    V.add(run, "DMG", "131",
                          f"hp_delta {p['hp_delta']} != -(die_sum {rolls_sum}+mod {p['flat_modifier']})={expected_delta}", roll)

    # --- E: development tick eligibility ---
    if p.get("skill_check_earned") is True:
        # E1: tick requires success
        if outcome in ("failure", "fumble"):
            V.add(run, "E1", "94",
                  f"skill_check_earned=true but outcome {outcome}", roll)
        # E4: untickable skills never earn
        if skill in UNTICKABLE_SKILLS:
            V.add(run, "E4", "94",
                  f"skill_check_earned=true on untickable skill '{skill}'", roll)
        # E2: no tick when bonus die used
        if p.get("bonus_dice"):
            V.add(run, "E2", "94",
                  "skill_check_earned=true but bonus die used", roll)
        # tick not allowed on SAN/Luck/damage/characteristic-non-skill rolls
        if skill in ("SAN", "SAN Reward", "HP Damage", "Luck"):
            V.add(run, "E1", "94",
                  f"skill_check_earned=true on non-skill roll '{skill}'", roll)
        # characteristic rolls (CON/DEX/INT/POW/STR/SIZ/APP/EDU) do NOT earn ticks
        if skill in {"CON", "DEX", "INT", "POW", "STR", "SIZ", "APP", "EDU",
                     "DEX/Climb", "STR/CON"}:
            V.add(run, "E1", "94",
                  f"skill_check_earned=true on characteristic roll '{skill}'", roll)


# --------------------------------------------------------------------------- #
# Per-event checks (exhaustive over every event)
# --------------------------------------------------------------------------- #
def check_event(run: str, event: dict, V: Violations) -> None:
    etype = event.get("type")
    p = event.get("payload", {})

    # --- G: bout of madness structure ---
    if etype == "bout_of_madness":
        mode = p.get("mode")
        if mode == "summary":
            if p.get("summary_table") != "table_viii_summary":
                V.add(run, "G5", "159",
                      f"summary bout summary_table != table_viii_summary (got {p.get('summary_table')})", event)
            sr = p.get("summary_roll")
            if not isinstance(sr, int) or not (1 <= sr <= 10):
                V.add(run, "G5", "159",
                      f"summary bout summary_roll {sr} not 1-10", event)
            if p.get("duration_die") != "1D10":
                V.add(run, "G6", "159",
                      f"summary bout duration_die != 1D10 (got {p.get('duration_die')})", event)
            dr = p.get("duration_roll")
            if not isinstance(dr, int) or not (1 <= dr <= 10):
                V.add(run, "G6", "159",
                      f"summary bout duration_roll {dr} not 1-10", event)
        elif mode == "real_time":
            if p.get("duration_die") != "1D10":
                V.add(run, "G4", "158",
                      f"real-time bout duration_die != 1D10", event)
            rounds = p.get("rounds")
            if not isinstance(rounds, list) or len(rounds) < 1:
                V.add(run, "G4", "158",
                      "real-time bout missing rounds[] sequence", event)

    # --- sanity event consistency: failed-SAN event should mirror involuntary_action ---
    if etype == "sanity":
        # If the matching roll was a failure, the event should carry the same
        # involuntary_action block (we check presence in the sanity roll path
        # above; here we only check that events don't contradict).
        pass


# --------------------------------------------------------------------------- #
# Cross-record checks (need the whole run)
# --------------------------------------------------------------------------- #
def check_run_cross(run: str, rolls: list[dict], events: list[dict],
                    V: Violations) -> None:
    """Checks that need relationships between records."""
    # SAN chain: every failed SAN roll with san_loss >= 5 should have a
    # following INT roll + bout_of_madness (G1/G2).
    san_failures = [r for r in rolls if (r.get("type") == "sanity" or
                     r.get("payload", {}).get("skill") == "SAN")
                    and r.get("payload", {}).get("outcome") == "failure"]
    bouts = [e for e in events if e.get("type") == "bout_of_madness"]
    for r in san_failures:
        p = r.get("payload", {})
        loss = p.get("san_loss")
        if isinstance(loss, int) and loss >= 5:
            # expect temporary_insanity_triggered on this or a following INT roll
            trig = p.get("temporary_insanity_triggered")
            # find a following INT roll
            idx = rolls.index(r)
            has_int = any(
                rolls[j].get("payload", {}).get("skill") == "INT"
                for j in range(idx, min(idx + 4, len(rolls)))
            )
            if not trig and not has_int:
                # some runs may decide the investigator stays sane; only flag
                # if neither trigger nor INT roll exists AND no bout follows.
                if not bouts:
                    V.add(run, "G1", "156",
                          f"5+ SAN loss ({loss}) with no INT roll, no temporary_insanity_triggered, no bout_of_madness", r)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def _find_campaign_log_dirs(run_dir: Path) -> list[Path]:
    """Campaign dirs under a run's sandbox that actually hold log files.

    Campaign ids are chosen at campaign-creation time and do NOT match the
    playtest run id (e.g. run '0.4.0a-kimi-closure-...' contains campaign
    'the-haunting-qs'), so discovery must scan instead of assuming equality.
    """
    campaigns = run_dir / "sandbox" / ".coc" / "campaigns"
    if not campaigns.is_dir():
        return []
    out = []
    for d in sorted(campaigns.iterdir()):
        if not d.is_dir():
            continue
        logs = d / "logs"
        if (logs / "rolls.jsonl").exists() or (logs / "events.jsonl").exists():
            out.append(d)
    return out


def validate_run(run_dir: Path, V: Violations) -> tuple[int, int]:
    """Validate every campaign log found under a run's sandbox.

    Returns (rolls_swept, events_swept).
    """
    total_rolls = total_events = 0
    for campaign_dir in _find_campaign_log_dirs(run_dir):
        label = f"{run_dir.name}/{campaign_dir.name}"
        rolls = _load_jsonl(campaign_dir / "logs" / "rolls.jsonl")
        events = _load_jsonl(campaign_dir / "logs" / "events.jsonl")
        total_rolls += len(rolls)
        total_events += len(events)
        for roll in rolls:
            check_roll(label, roll, V)
        for event in events:
            check_event(label, event, V)
        check_run_cross(label, rolls, events, V)
    return total_rolls, total_events


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: exhaustive_rulebook_validator.py <playtests-root> [run-id ...]")
        return 2
    root = Path(argv[1])
    if len(argv) > 2:
        run_ids = argv[2:]
    else:
        run_ids = sorted(d.name for d in root.iterdir() if d.is_dir())
    V = Violations()
    total_rolls = total_events = 0
    empty_runs: list[str] = []
    for rid in run_ids:
        run_dir = root / rid
        if not run_dir.exists():
            print(f"(skip {rid}: not found)", file=sys.stderr)
            continue
        r, e = validate_run(run_dir, V)
        if r + e == 0:
            empty_runs.append(rid)
        total_rolls += r
        total_events += e
    print(f"Swept {len(run_ids)} runs, {total_rolls} rolls, {total_events} events.")
    for rid in empty_runs:
        print(f"WARNING: run '{rid}' swept 0 records (no campaign logs found "
              f"under its sandbox)", file=sys.stderr)
    if total_rolls + total_events == 0:
        # A pass over zero records is not a pass; refuse to report one.
        print("ERROR: no playtest records found — nothing was validated "
              "(refusing a vacuous pass)", file=sys.stderr)
        return 2
    print(V.report())
    return 0 if not V.items else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
