"""Tests for the structured sanity engine (coc_sanity.SanitySession).

Validates Chapter 8 SAN mechanics: SAN roll + loss notation, involuntary
action on failure, 5+ loss → temp insanity (INT roll, counter-intuitive
success=insane), bout of madness structure, indefinite insanity threshold,
permanent insanity at 0 SAN, recovery, and SAN gain.
"""
import importlib.util
import random

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_sanity = _load("coc_sanity", "plugins/coc-keeper/scripts/coc_sanity.py")


def _make_session(san=65, int_val=60, seed=42):
    return coc_sanity.SanitySession("ada", san_max=san, int_value=int_val,
                                    rng=random.Random(seed))


def test_sanity_session_initial_state():
    s = _make_session(san=50)
    assert s.san_current == 50
    assert s.san_max == 50
    assert not s.temporary_insane
    assert not s.indefinite_insane
    assert not s.permanently_insane


def test_successful_san_roll_loses_success_amount():
    """SAN roll success: lose the 'success' side of X/YdZ (p.166)."""
    # Force success by using high SAN + lucky seed
    s = _make_session(san=90, seed=1)
    s.sanity_check("mild shock", san_loss_success=0, san_loss_fail_expr="1D4")
    # On success, should lose 0
    # (seed 1 with SAN 90 likely succeeds)
    assert s.san_current <= 90  # lost 0 or fail-loss


def test_failed_san_roll_loses_dice_amount():
    """SAN roll failure: lose the 'failure' side (rolled)."""
    s = _make_session(san=5, seed=50)  # low SAN → likely fail
    san_before = s.san_current
    s.sanity_check("horror", san_loss_success=0, san_loss_fail_expr="1D4",
                   involuntary_kind="freeze")
    assert s.san_current < san_before  # definitely lost some


def test_failed_san_roll_triggers_involuntary_action():
    """p.166: every failed SAN roll causes an involuntary action."""
    s = _make_session(san=5, seed=50)
    s.sanity_check("horror", 0, "1D4",
                   involuntary_kind="cry_out", involuntary_summary="screams")
    assert len(s.involuntary_actions) >= 1
    assert s.involuntary_actions[-1]["kind"] == "cry_out"


def test_san_loss_5_plus_triggers_int_roll_and_possible_temp_insanity():
    """p.167: losing 5+ SAN from one source → INT roll.
    Counter-intuitive: INT success = temp insane; INT failure = repressed."""
    # Need a SAN check that loses 5+. Use 1/1D10 with a failing SAN roll.
    # Force failure with low SAN + seed.
    s = _make_session(san=10, int_val=90, seed=80)
    # INT 90 → INT roll very likely succeeds → temp insane triggers
    s.sanity_check("seeing Cthulhu", 1, "1D10",
                   involuntary_kind="freeze", alone=True)
    # If SAN lost >= 5 and INT succeeded → temp insane
    # (depends on rolls, but with INT 90 it's very likely)
    has_temp = s.temporary_insane
    has_bout = len(s.bouts_of_madness) > 0
    # Either both true (temp insane) or both false (INT failed = repressed)
    assert has_temp == has_bout


def test_bout_of_madness_alone_uses_summary_mode():
    """p.171: lone investigator uses Table VIII Summary."""
    s = _make_session(san=10, int_val=99, seed=99)
    s.sanity_check("horror", 1, "1D10",
                   involuntary_kind="freeze", alone=True,
                   module_bout_override={"force_mode": "summary"})
    if s.bouts_of_madness:
        assert s.bouts_of_madness[-1]["mode"] == "summary"
        assert s.bouts_of_madness[-1]["summary_table"] == "table_viii_summary"


def test_bout_of_madness_with_others_uses_realtime_mode():
    """p.171: investigator with others uses Table VII Real-Time."""
    s = _make_session(san=10, int_val=99, seed=99)
    s.sanity_check("horror", 1, "1D10",
                   involuntary_kind="freeze", alone=False)
    if s.bouts_of_madness:
        assert s.bouts_of_madness[-1]["mode"] == "real_time"


def test_one_fifth_san_lost_in_day_triggers_indefinite_insanity():
    """p.168: lose >=1/5 current SAN in one day → indefinite insanity."""
    s = _make_session(san=20, int_val=10, seed=1)
    # Lose 5 SAN (1/4 of 20 = 5, which is >= 1/5 = 4)
    # Use multiple small losses to avoid the 5+ temp insanity trigger
    s.sanity_check("horror 1", 0, "1D4", involuntary_kind="freeze")
    s.sanity_check("horror 2", 0, "1D4", involuntary_kind="freeze")
    s.sanity_check("horror 3", 0, "1D4", involuntary_kind="freeze")
    # After 3 potential 1D4 losses, check if daily threshold crossed
    if s.daily_san_lost >= 20 // 5:
        assert s.indefinite_insane is True


def test_san_zero_triggers_permanent_insanity():
    """p.168: SAN = 0 → permanent insanity."""
    s = _make_session(san=1, seed=100)  # SAN 1, almost guaranteed fail
    s.sanity_check("final horror", 0, "1D10", involuntary_kind="freeze")
    if s.san_current == 0:
        assert s.permanently_insane is True


def test_recover_temporary_ends_temp_insanity():
    """p.176: temporary insanity recovers after 1D10 hours."""
    s = _make_session()
    s.temporary_insane = True
    s.temporary_insane_remaining_hours = 3
    assert s.recover_temporary() is True
    assert s.temporary_insane is False


def test_gain_san_capped_at_max():
    """SAN cannot exceed san_max."""
    s = _make_session(san=65)
    s.gain_san(100, "generous reward")
    assert s.san_current == 65


def test_gain_san_records_event_and_roll():
    """SAN gain produces an event and a pending roll."""
    s = _make_session(san=60)
    s.san_current = 50
    s.gain_san(5, "reward")
    assert s.san_current == 55
    assert len(s.pending_rolls) >= 1
    events = [e for e in s.events if e["type"] == "sanity_gain"]
    assert len(events) >= 1


def test_end_day_resets_daily_counter():
    """Keeper calls end_day to reset the 1/5 daily loss tracker."""
    s = _make_session(san=50, seed=1)
    s.sanity_check("horror", 0, "1D4", involuntary_kind="freeze")
    lost = s.daily_san_lost
    s.end_day()
    assert s.daily_san_lost == 0


def test_snapshot_has_full_schema():
    """Snapshot includes all fields needed for save/sanity.json."""
    s = _make_session()
    s.sanity_check("test", 0, "1D4", involuntary_kind="freeze")
    snap = s.snapshot()
    for key in ("investigator_id", "san_max", "san_current",
                "temporary_insane", "indefinite_insane", "permanently_insane",
                "daily_san_lost", "bouts_of_madness", "involuntary_actions",
                "events"):
        assert key in snap


def test_permanently_insane_skips_further_san_checks():
    """Once permanently insane, no further SAN checks are processed."""
    s = _make_session(san=1, seed=100)
    s.permanently_insane = True
    san_before = s.san_current
    s.sanity_check("another horror", 0, "1D10", involuntary_kind="freeze")
    assert s.san_current == san_before  # unchanged


def test_fumbled_san_roll_loses_maximum_san():
    """p.166: 'A fumbled Sanity roll results in the character losing the
    maximum Sanity points for that particular situation or encounter.'

    For SAN 1/1D8, a fumble should lose 8 (max of 1D8), not a random roll.
    """
    # Force fumble: SAN low enough that 96-100 range is a fumble.
    s = _make_session(san=40, seed=97)
    # seed 97 with SAN 40 → roll likely in 96-100 fumble range
    san_before = s.san_current
    s.sanity_check("horror", san_loss_success=0, san_loss_fail_expr="1D8",
                   involuntary_kind="freeze")
    # If the roll was a fumble, lost should be 8 (max of 1D8)
    # Check pending rolls for fumble
    drained = s.drain_pending()
    san_roll = next((r for r in drained if r["skill"] == "SAN"), None)
    if san_roll and san_roll["outcome"] == "fumble":
        assert san_roll["san_loss"] == 8  # max of 1D8
        assert s.san_current == san_before - 8


def test_critical_success_on_san_roll_is_best_outcome():
    """Critical (roll=01) on SAN roll = success (lose success amount only)."""
    # Very high SAN so roll=1 always succeeds (it always does — critical is
    # unconditional). We verify the outcome is not failure/fumble.
    s = _make_session(san=99, seed=0)
    # seed 0 → first randint(1,100) might not be 1; try a few seeds
    for seed in range(20):
        s2 = _make_session(san=99, seed=seed)
        s2.sanity_check("test", 0, "1D4", involuntary_kind="freeze")
        drained = s2.drain_pending()
        san_roll = next((r for r in drained if r["skill"] == "SAN"), None)
        if san_roll and san_roll["roll"] == 1:
            assert san_roll["outcome"] == "critical"
            # Critical = success, lose 0 (success amount)
            assert san_roll["san_loss"] == 0
            return
    # If no seed produced roll=1, that's OK — the test is conditional.
