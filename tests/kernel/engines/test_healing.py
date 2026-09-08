"""Tests for the healing/recovery layer (Chapter 6) and SAN treatment (Chapter
8). Ported from the old tree's `tests/test_healing.py` (subject: `coc_healing.py`,
now `kernel/coc/rules/healing.py`).

Validates: First Aid (+1 HP, push, once-per-wound, teamwork), Medicine (+1D3,
hard if not same day), the dying/stabilized CON clocks, weekly_recovery (1 HP/day;
major wound defers to the weekly CON roll), major_wound_recovery_roll, HP
capping, snapshot persistence, the downtime-trigger integration, and
PsychotherapySession (monthly treatment, asylum, indefinite cure, self-help).

API changes from the port (behavior itself is a verbatim carry-over):
- `HealingSession` and `PsychotherapySession` both take a `RuleTables` instance
  as their new first constructor argument (real percentile checks now come
  from `.rules.percentile` against the injected tables rather than a
  module-global rules dir); `HealingSession.load()` takes `tables` too.
- The snapshot moved from the old shared `save/investigator-state/<inv>.json`
  to `save/healing-state/<inv>.json`, written via `write_healing_state()` /
  read via `read_healing_state()` (no more private `_write_inv_state`).
- Dropped: the `logs/events.jsonl` append — the kernel returns events to the
  caller instead of owning a log (see the module docstring: "the kernel's
  events.jsonl is a closed enum"). `handle_time_trigger` now also takes
  `tables` as its first argument.
"""

from __future__ import annotations

import json
import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.healing import (  # noqa: E402
    HealingSession,
    PsychotherapySession,
    handle_time_trigger,
    read_healing_state,
    write_healing_state,
)
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"
SUCCESS = ("regular", "hard", "extreme", "critical")


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


def _roll(outcome: str) -> dict:
    """A pre-resolved skill roll result with a given outcome."""
    return {"outcome": outcome, "roll": 50, "target": 60, "effective_target": 60,
            "difficulty": "regular", "bonus": 0, "penalty": 0}


def _session(tables, investigator_id="inv1", **kwargs) -> HealingSession:
    return HealingSession(tables, investigator_id, **kwargs)


# --------------------------------------------------------------------------- #
# First Aid (p.119)
# --------------------------------------------------------------------------- #
def test_first_aid_success_heals_one_hp(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 9
    assert ev["hp_gained"] == 1


def test_first_aid_failure_heals_nothing(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("failure"))
    assert sess.current_hp == 8
    assert ev["hp_gained"] == 0


def test_two_rescuer_first_aid_heals_once_when_either_roll_succeeds(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    primary = {**_roll("failure"), "roll": 80, "target": 60}
    assistant = {**_roll("regular"), "roll": 40, "target": 50}

    event = sess.first_aid(
        60,
        skill_roll_result=primary,
        rescuer_id="rescuer-primary",
        assistant_skill_value=50,
        assistant_roll_result=assistant,
        assistant_rescuer_id="rescuer-assistant",
    )

    assert sess.current_hp == 9
    assert event["hp_gained"] == 1
    assert event["outcome"] == "regular"
    assert event["teamwork"] is True
    assert event["team_rolls"] == [
        {"rescuer_id": "rescuer-primary", "outcome": "failure", "roll": 80,
         "target": 60, "difficulty": "regular"},
        {"rescuer_id": "rescuer-assistant", "outcome": "regular", "roll": 40,
         "target": 50, "difficulty": "regular"},
    ]


def test_two_rescuer_first_aid_both_fail_without_duplicate_treatment(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)

    event = sess.first_aid(
        60,
        skill_roll_result={**_roll("failure"), "roll": 80, "target": 60},
        rescuer_id="rescuer-primary",
        assistant_skill_value=50,
        assistant_roll_result={**_roll("failure"), "roll": 70, "target": 50},
        assistant_rescuer_id="rescuer-assistant",
    )

    assert sess.current_hp == 8
    assert event["hp_gained"] == 0
    assert event["outcome"] == "failure"
    assert len(event["team_rolls"]) == 2
    assert sess._first_aid_used_today is True


def test_first_aid_capped_at_hp_max(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=12)
    ev = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 12
    assert ev["hp_gained"] == 0  # already at max


def test_first_aid_can_be_pushed(tables):
    """Pushing allows a second attempt (first_aid_used_today is reset on push)."""
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess.current_hp == 9
    ev2 = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert ev2["already_used_today"] is True
    assert sess.current_hp == 9  # no further gain
    ev3 = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"), pushed=True)
    assert ev3["pushed"] is True
    assert sess.current_hp == 10
    ev4 = sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"), pushed=True)
    assert ev4["push_already_used"] is True
    assert sess.current_hp == 10


# --------------------------------------------------------------------------- #
# Dying chain (p.121): First Aid stabilizes -> hourly CON -> Medicine clears
# --------------------------------------------------------------------------- #
def _dying_session(tables, seed: int = 7) -> HealingSession:
    return HealingSession(
        tables, "harvey", hp_max=12, con_value=60, rng=random.Random(seed),
        current_hp=0, conditions=["major_wound", "dying"])


def test_first_aid_stabilizes_dying_character(tables):
    sess = _dying_session(tables)
    ev = sess.first_aid(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "first_aid_stabilize"
    assert sess.current_hp == 1
    assert "stabilized" in sess.conditions
    assert "dying" in sess.conditions  # dying clears only via Medicine (p.121)


def test_first_aid_on_stabilized_dying_does_not_heal_further(tables):
    sess = _dying_session(tables)
    sess.first_aid(99, skill_roll_result=_roll("regular"))
    ev = sess.first_aid(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "healing_skipped"
    assert sess.current_hp == 1


def test_first_aid_clears_non_dying_unconscious_after_healing(tables):
    sess = _session(tables, investigator_id="eleanor", hp_max=10, con_value=50,
                    current_hp=1, conditions=["major_wound", "prone", "unconscious"])
    event = sess.first_aid(60, skill_roll_result=_roll("regular"))
    assert event["hp_after"] == 2
    assert "unconscious" not in sess.conditions
    assert "major_wound" in sess.conditions


def test_first_aid_failure_does_not_stabilize(tables):
    sess = _dying_session(tables)
    ev = sess.first_aid(10, skill_roll_result=_roll("failure"))
    assert ev["event_type"] == "first_aid"
    assert ev["stabilized"] is False
    assert sess.current_hp == 0
    assert "stabilized" not in sess.conditions


def test_medicine_cannot_stabilize_dying(tables):
    sess = _dying_session(tables)
    ev = sess.medicine(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "healing_skipped"
    assert "First Aid" in ev["reason"]


def test_medicine_clears_dying_after_stabilization(tables):
    sess = _dying_session(tables)
    sess.conditions.append("unconscious")
    sess.first_aid(99, skill_roll_result=_roll("regular"))
    ev = sess.medicine(99, skill_roll_result=_roll("regular"))
    assert ev["event_type"] == "medicine"
    assert "dying" not in sess.conditions
    assert "stabilized" not in sess.conditions
    assert "unconscious" not in sess.conditions
    assert sess.current_hp >= 2  # 1 temporary + 1D3


def test_dying_con_roll_failure_kills(tables):
    sess = _dying_session(tables)
    ev = sess.dying_con_roll(roll_result=_roll("failure"))
    assert ev["died"] is True
    assert "dead" in sess.conditions


def test_dying_con_roll_success_holds_on(tables):
    sess = _dying_session(tables)
    sess.first_aid(1, skill_roll_result=_roll("failure"))
    sess.first_aid(1, skill_roll_result=_roll("failure"), pushed=True)
    assert sess._first_aid_used_today is True
    assert sess._first_aid_push_used_today is True
    ev = sess.dying_con_roll(roll_result=_roll("regular"))
    assert ev["died"] is False
    assert "dead" not in sess.conditions
    assert sess._first_aid_used_today is True
    assert sess._first_aid_push_used_today is False


def test_stabilized_con_roll_failure_reverts_to_dying(tables):
    sess = _dying_session(tables)
    sess.first_aid(1, skill_roll_result=_roll("failure"))
    sess.first_aid(99, skill_roll_result=_roll("regular"), pushed=True)
    assert sess._first_aid_used_today is True
    assert sess._first_aid_push_used_today is True
    sess.stabilized_con_roll(roll_result=_roll("failure"))
    assert sess.current_hp == 0
    assert "stabilized" not in sess.conditions
    assert "dying" in sess.conditions
    assert sess._first_aid_used_today is True
    assert sess._first_aid_push_used_today is False


# --------------------------------------------------------------------------- #
# Medicine (p.120)
# --------------------------------------------------------------------------- #
def test_medicine_success_heals_1d3(tables):
    rng = random.Random(1)
    sess = HealingSession(tables, "inv1", hp_max=12, con_value=60, current_hp=5, rng=rng)
    ev = sess.medicine(skill_value=60)
    assert 1 <= ev["hp_gained"] <= 3
    assert sess.current_hp == 5 + ev["hp_gained"]


def test_medicine_hard_difficulty_if_not_same_day(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=5)
    ev = sess.medicine(skill_value=60, same_day=False)
    assert ev["difficulty"] == "hard"


def test_medicine_once_per_day(tables):
    rng = random.Random(2)
    sess = HealingSession(tables, "inv1", hp_max=12, con_value=60, current_hp=5, rng=rng)
    sess.medicine(skill_value=60)
    hp_after_first = sess.current_hp
    sess.medicine(skill_value=60)
    assert sess.current_hp == hp_after_first  # no double-medicine same day


# --------------------------------------------------------------------------- #
# Weekly recovery (p.122)
# --------------------------------------------------------------------------- #
def test_weekly_recovery_no_major_wound(tables):
    """No major wound: 1 HP per day of rest."""
    sess = _session(tables, hp_max=12, con_value=60, current_hp=5)
    ev = sess.weekly_recovery(days_of_rest=3)
    assert ev["hp_gained"] == 3
    assert sess.current_hp == 8


def test_weekly_recovery_capped_at_max(tables):
    sess = _session(tables, hp_max=10, con_value=60, current_hp=9)
    ev = sess.weekly_recovery(days_of_rest=5)
    assert sess.current_hp == 10
    assert ev["hp_gained"] == 1


def test_weekly_recovery_with_major_wound_defers_to_weekly_con_roll(tables):
    """Major wound: natural rest alone no longer heals per-day; the weekly
    CON recovery roll (major_wound_recovery_roll) is the only path (p.121)."""
    rng = random.Random(42)
    sess = HealingSession(tables, "inv1", hp_max=12, con_value=70, current_hp=2,
                          conditions=["major_wound"], rng=rng)
    ev = sess.weekly_recovery(days_of_rest=3)
    assert ev["had_major_wound"] is True
    assert ev["hp_gained"] == 0
    assert ev["major_wound_recovery_required"] is True
    assert sess.current_hp == 2


# --------------------------------------------------------------------------- #
# Major wound recovery -- weekly CON roll (p.121)
# --------------------------------------------------------------------------- #
def _wounded_session(tables, con: int = 50, seed: int = 3) -> HealingSession:
    return HealingSession(tables, "h", hp_max=15, con_value=con, rng=random.Random(seed),
                          current_hp=4, conditions=["major_wound"])


def test_major_wound_recovery_is_weekly_con_roll(tables):
    sess = _wounded_session(tables, con=99)
    ev = sess.major_wound_recovery_roll(roll_result=_roll("regular"))
    assert ev["event_type"] == "major_wound_recovery"
    assert ev["skill"] == "CON"
    assert ev["roll"] == 50
    assert ev["target"] == 99
    assert ev["difficulty"] == "regular"
    assert ev["healing_dice"]["expression"] == "1D3"
    assert ev["healing_dice"]["total"] == sum(ev["healing_dice"]["raw"])
    assert 1 <= ev["hp_gained"] <= 3


def test_major_wound_recovery_failure_heals_nothing(tables):
    sess = _wounded_session(tables)
    ev = sess.major_wound_recovery_roll(roll_result=_roll("failure"))
    assert ev["hp_gained"] == 0
    assert "major_wound" in sess.conditions


def test_recovery_bonus_dice_from_rest_and_care(tables):
    sess = _wounded_session(tables)
    ev = sess.major_wound_recovery_roll(complete_rest=True, medical_care_success=True)
    assert ev["bonus_dice"] == 2 and ev["penalty_dice"] == 0


def test_recovery_penalty_die_from_poor_environment(tables):
    sess = _wounded_session(tables)
    ev = sess.major_wound_recovery_roll(poor_environment=True)
    assert ev["penalty_dice"] == 1


def test_recovery_extreme_success_clears_major_wound(tables):
    sess = _wounded_session(tables, con=99)
    ev = sess.major_wound_recovery_roll(roll_result=_roll("extreme"))
    assert 2 <= ev["hp_gained"] <= 6
    assert ev["healing_dice"]["expression"] == "2D3"
    assert len(ev["healing_dice"]["raw"]) == 2
    assert "major_wound" not in sess.conditions


def test_recovery_fumble_emits_lasting_injury(tables):
    sess = _wounded_session(tables, con=10)
    sess.major_wound_recovery_roll(roll_result=_roll("fumble"))
    assert any(e["event_type"] == "lasting_injury" for e in sess.events)


def test_weekly_recovery_zero_days_is_noop(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=5)
    ev = sess.weekly_recovery(days_of_rest=0)
    assert ev["hp_gained"] == 0


def test_healing_clears_major_wound_above_half_hp(tables):
    """major_wound clears once HP restored to >= half max (p.122 heuristic)."""
    sess = _session(tables, hp_max=12, con_value=60, current_hp=4, conditions=["major_wound"])
    # half of 12 = 6; heal to 7 -> clears
    sess._heal(3)
    assert sess.current_hp == 7
    assert "major_wound" not in sess.conditions


def test_healing_uses_ceiling_half_for_odd_hp_maximum(tables):
    sess = _session(tables, hp_max=11, con_value=60, current_hp=4, conditions=["major_wound"])
    sess._heal(1)
    assert sess.current_hp == 5
    assert "major_wound" in sess.conditions
    sess._heal(1)
    assert sess.current_hp == 6
    assert "major_wound" not in sess.conditions


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save" / "healing-state").mkdir(parents=True)
    return camp


def test_save_writes_hp_and_conditions(tables, campaign):
    sess = HealingSession(tables, "inv1", hp_max=12, con_value=60, current_hp=3,
                          conditions=["major_wound"])
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    path = sess.save(campaign)
    data = json.loads(path.read_text())
    assert data["current_hp"] == 4
    assert "major_wound" in data["conditions"]  # 4 < half-max(6), wound persists


def test_save_merges_with_existing_snapshot(tables, campaign):
    path = campaign / "save" / "healing-state" / "inv1.json"
    path.write_text(json.dumps({"investigator_id": "inv1", "note": "keep-me"}))
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    sess.save(campaign)
    data = json.loads(path.read_text())
    assert data["current_hp"] == 8
    assert data["note"] == "keep-me"  # preserved


def test_load_reconstructs_session(tables, campaign):
    sess = HealingSession(tables, "inv1", hp_max=12, con_value=60, current_hp=8,
                          conditions=["major_wound"])
    sess.save(campaign)
    loaded = HealingSession.load(tables, campaign, "inv1", hp_max=12, con_value=60)
    assert loaded.current_hp == 8
    assert "major_wound" in loaded.conditions


# --------------------------------------------------------------------------- #
# downtime integration
# --------------------------------------------------------------------------- #
def test_handle_time_trigger_sleep_heals(tables, campaign):
    """A sleep_night advance (>=6h) heals via weekly_recovery."""
    write_healing_state(campaign, "inv1", {"investigator_id": "inv1", "current_hp": 6, "conditions": []})
    gained = handle_time_trigger(tables, campaign, "inv1", hp_max=12, con_value=60, delta_minutes=480)
    assert gained == 1  # one day of rest
    data = json.loads((campaign / "save" / "healing-state" / "inv1.json").read_text())
    assert data["current_hp"] == 7


def test_handle_time_trigger_zero_minutes_noop(tables, campaign):
    write_healing_state(campaign, "inv1", {"investigator_id": "inv1", "current_hp": 6})
    gained = handle_time_trigger(tables, campaign, "inv1", hp_max=12, con_value=60, delta_minutes=0)
    assert gained == 0


def test_reset_daily_treatments(tables):
    sess = _session(tables, hp_max=12, con_value=60, current_hp=8)
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"))
    assert sess._first_aid_used_today is True
    sess.first_aid(skill_value=60, skill_roll_result=_roll("regular"), pushed=True)
    assert sess._first_aid_push_used_today is True
    sess.reset_daily_treatments()
    assert sess._first_aid_used_today is False
    assert sess._first_aid_push_used_today is False


# --------------------------------------------------------------------------- #
# downtime integration: the rulebook's units (#76)
# --------------------------------------------------------------------------- #
def _downtime(tables, campaign, minutes, *, hp, hp_max=12, conditions=()):
    """One `handle_time_trigger` over a fresh snapshot; returns (hp gained, snapshot after)."""
    write_healing_state(campaign, "inv1", {"investigator_id": "inv1", "current_hp": hp,
                                           "conditions": list(conditions)})
    gained = handle_time_trigger(tables, campaign, "inv1", hp_max=hp_max, con_value=60, delta_minutes=minutes)
    return gained, read_healing_state(campaign, "inv1")


@pytest.mark.parametrize("minutes,expected", [
    (360, 1), (480, 1), (1439, 1),      # six hours or more: the one night's rest is the first day
    (1440, 1), (2879, 1), (2880, 2),    # the day turns at 24 hours, not at eight (#76: 1440 healed 3)
    (10080, 7), (43200, 30),            # a week is seven; thirty days are thirty (#76: capped at 7)
])
def test_handle_time_trigger_heals_one_hp_per_day_of_the_clock(tables, campaign, minutes, expected):
    """p.121 Regular Damage Recovery: "the character recovers 1 hit point per day"."""
    gained, state = _downtime(tables, campaign, minutes, hp=5, hp_max=40)
    assert gained == expected
    assert state["current_hp"] == 5 + expected


def test_handle_time_trigger_major_wound_rolls_con_once_per_full_week(tables, campaign, monkeypatch):
    """p.121 Major Wound Recovery: "a CON roll should be made at the end of each week of game
    time that the Major Wound box is ticked". Counted directly — the roll is stubbed, so the
    box never clears: two days and a third make no roll (#76: 3360 minutes rolled one), a week
    one, three weeks three (#76: one), thirty days four. The days between heal nothing."""
    calls: list[dict] = []
    monkeypatch.setattr(HealingSession, "major_wound_recovery_roll",
                        lambda self, **kwargs: calls.append(kwargs) or {})
    for minutes, rolls in [(480, 0), (3360, 0), (10079, 0), (10080, 1), (30240, 3), (43200, 4)]:
        calls.clear()
        gained, state = _downtime(tables, campaign, minutes, hp=4, conditions=["major_wound"])
        assert len(calls) == rolls, f"{minutes} minutes"
        assert all(kwargs == {"complete_rest": True} for kwargs in calls)
        assert gained == 0 and state["current_hp"] == 4, "no per-day recovery while the box is ticked"
        assert "major_wound" in state["conditions"]


def test_handle_time_trigger_regular_recovery_resumes_once_the_box_clears(tables, campaign, monkeypatch):
    """Three weeks, and the first week's roll is an Extreme success (stubbed: +4 and the box
    erased). The fortnight after it is fourteen days without a major wound: 1 HP each, and no
    further CON roll — the book asks for one only while the box is ticked, and a fumble on a
    roll it never asked for would hand out a lasting injury."""
    calls: list[dict] = []

    def extreme(self, **kwargs):
        calls.append(kwargs)
        self.conditions.remove("major_wound")
        self._heal(4)
        return {}

    monkeypatch.setattr(HealingSession, "major_wound_recovery_roll", extreme)
    gained, state = _downtime(tables, campaign, 30240, hp=4, hp_max=40, conditions=["major_wound"])
    assert len(calls) == 1
    assert gained == 4 + 14
    assert state["current_hp"] == 4 + 4 + 14
    assert "major_wound" not in state["conditions"]


def test_handle_time_trigger_major_wound_rolls_real_dice(tables, campaign):
    """Unstubbed: over a month the loop rolls the engine's own CON check with its bonus die
    for complete rest, and every hit point it hands back is a whole number under the ceiling."""
    gained, state = _downtime(tables, campaign, 43200, hp=2, conditions=["major_wound"])
    assert 0 <= gained <= 10
    assert state["current_hp"] == 2 + gained


# --------------------------------------------------------------------------- #
# monthly treatment / asylum tiers / indefinite cure / self-help (p.164-168)
# --------------------------------------------------------------------------- #
def test_treatment_json_monthly_roll_and_quality_tiers():
    """treatment.json exposes private-care monthly roll + asylum quality tiers."""
    path = RULES / "treatment.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    monthly = data["psychoanalysis"]["monthly_roll"]
    assert monthly["success_range"] == [1, 95]
    assert monthly["gain"] == "1D3"
    assert monthly["setback_loss"] == "1D6"
    tiers = data["asylum_confinement"]["quality_tiers"]
    assert tiers["good"]["monthly_bonus_die"] is True
    assert tiers["poor"]["monthly_penalty_die"] is True


def test_monthly_treatment_roll_success_gains_1d3(tables):
    """01-95 on the monthly private-care roll recovers 1D3 SAN (p.164)."""
    for seed in range(1, 500):
        state = {"current_san": 40, "max_san": 90}
        sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(seed))
        ev = sess.monthly_treatment_roll()
        if ev.get("setback"):
            continue
        assert ev["san_delta"] >= 1
        assert state["current_san"] == 40 + ev["san_delta"]
        assert sess.monthly_gains_count == 1
        return
    pytest.fail("no monthly success seed found")


def test_monthly_treatment_roll_setback_loses_1d6(tables):
    """96-00 is a setback: lose 1D6 SAN (p.164)."""
    for seed in range(1, 800):
        state = {"current_san": 40, "max_san": 90}
        sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(seed))
        ev = sess.monthly_treatment_roll()
        if not ev.get("setback"):
            continue
        assert ev["san_delta"] <= -1
        assert state["current_san"] == 40 + ev["san_delta"]
        assert sess.monthly_gains_count == 0
        return
    pytest.fail("no monthly setback seed found")


def test_monthly_treatment_asylum_quality_applies_bonus_or_penalty_die(tables):
    """Asylum good/poor quality attaches bonus/penalty die to the monthly 1D100."""
    state = {"current_san": 40, "max_san": 90}
    good = PsychotherapySession(tables, "inv1", state, rng=random.Random(11))
    ev_good = good.monthly_treatment_roll(quality="good")
    assert ev_good["bonus"] == 1
    assert ev_good["penalty"] == 0

    poor = PsychotherapySession(tables, "inv1", dict(state), rng=random.Random(11))
    ev_poor = poor.monthly_treatment_roll(quality="poor")
    assert ev_poor["bonus"] == 0
    assert ev_poor["penalty"] == 1


def test_asylum_release_no_longer_recovers_to_max_san(tables):
    """Full-restore shortcut is neutralized; release uses monthly cadence."""
    for seed in range(1, 400):
        state = {"current_san": 40, "max_san": 90}
        sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(seed))
        sess.asylum_months_remaining = 3
        ev = sess.resolve_asylum_release(psychoanalysis_skill=99)
        assert state["current_san"] < 90 or ev.get("setback") is not None
        # Even on the best outcome, a single release cannot jump to max from 40.
        assert state["current_san"] <= 40 + 3  # at most +1D3
        return


def test_cure_indefinite_requires_prior_monthly_gain(tables):
    """cure_indefinite_check is gated behind at least one successful monthly gain."""
    state = {"current_san": 50, "max_san": 90, "indefinite_insane": True}
    sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(1))
    blocked = sess.cure_indefinite_check()
    assert blocked.get("blocked") == "monthly_gain_required"
    assert state.get("indefinite_insane") is True

    for seed in range(1, 500):
        state2 = {"current_san": 50, "max_san": 90, "indefinite_insane": True}
        sess2 = PsychotherapySession(tables, "inv1", state2, rng=random.Random(seed))
        monthly = sess2.monthly_treatment_roll()
        if monthly.get("setback") or sess2.monthly_gains_count < 1:
            continue
        for cure_seed in range(seed, seed + 300):
            state3 = {"current_san": state2["current_san"], "max_san": 90, "indefinite_insane": True}
            sess3 = PsychotherapySession(tables, "inv1", state3, rng=random.Random(cure_seed))
            sess3.monthly_gains_count = sess2.monthly_gains_count
            result = sess3.cure_indefinite_check()
            if result.get("blocked"):
                continue
            if result.get("cured"):
                assert state3.get("indefinite_insane") is False
                return
        return  # monthly gate works even if cure roll didn't succeed in scan
    pytest.fail("no monthly gain seed for cure gate")


def test_self_help_failure_returns_backstory_amend_required(tables):
    """Failed self-help returns structured backstory corruption (W1-2 shape)."""
    key = {"backstory_field": "significant_people", "summary": "trusted mentor from Arkham"}
    for seed in range(1, 500):
        state = {"current_san": 50, "max_san": 90}
        sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(seed))
        ev = sess.self_help(key_connection=key)
        if ev["outcome"] in ("failure", "fumble"):
            amend = ev["backstory_amend_required"]
            assert amend["mode"] == "corrupt_existing"
            assert amend["backstory_field"] == "significant_people"
            assert ev["san_delta"] == -1
            return
    pytest.fail("no self-help failure seed")


def test_psychotherapy_snapshot_persists_monthly_gains_count(tables):
    state = {"current_san": 50, "max_san": 90}
    sess = PsychotherapySession(tables, "inv1", state, rng=random.Random(1))
    sess.monthly_gains_count = 2
    snap = sess.snapshot()
    assert snap["monthly_gains_count"] == 2
    assert snap["asylum_months_remaining"] == 0
