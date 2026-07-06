#!/usr/bin/env python3
"""Tests for sanity <-> coc_time trigger integration.

Validates (p.176, p.168):
- _trigger_temporary_insanity schedules a recovery trigger via coc_time
  (due = current_elapsed + remaining_hours*60, handler
  recover_temporary_insanity, policy auto_apply_if_safe).
- recover_temporary clears the condition + emits a recovery event.
- end_day records the day boundary in the investigator's sanity period
  when the time layer is attached.
- All behavior degrades gracefully when campaign_dir is None (no time layer).
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest


PLUGIN_ROOT = Path("plugins/coc-keeper")


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, PLUGIN_ROOT / "scripts" / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_sanity = _load("coc_sanity", "coc_sanity.py")
coc_time = _load("coc_time", "coc_time.py")


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def campaign(tmp_path):
    camp = tmp_path / "campaign"
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    coc_time.initialize_time_state(camp)
    return camp


def _seed_for_bout_duration(target_hours: int) -> int:
    """Find a seed whose _trigger_temporary_insanity duration == target_hours.

    _trigger_temporary_insanity draws duration_hours=randint(1,10) first.
    """
    for seed in range(500):
        rng = random.Random(seed)
        if rng.randint(1, 10) == target_hours:
            return seed
    raise RuntimeError(f"no seed for duration={target_hours}")


# --------------------------------------------------------------------------- #
# Trigger scheduling
# --------------------------------------------------------------------------- #
def test_trigger_temporary_insanity_schedules_recovery_trigger(campaign):
    """Bout of madness schedules a recovery trigger due at now + hours*60."""
    # Advance the clock to a known baseline so 'now' is non-zero.
    coc_time.advance_time(campaign, 100, decision_id="d0", reason="arrive")
    hours = 7
    seed = _seed_for_bout_duration(hours)
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(seed),
        campaign_dir=campaign)
    s._trigger_temporary_insanity("horror", alone=False, module_bout_override=None)

    # A recovery trigger should now be pending in time-triggers.json
    trig_data = json.loads((campaign / "save" / "time-triggers.json").read_text())
    recovery = [t for t in trig_data["triggers"]
                if t.get("handler") == "recover_temporary_insanity"]
    assert len(recovery) == 1
    t = recovery[0]
    assert t["policy"] == "auto_apply_if_safe"
    assert t["status"] == "pending"
    # due = 100 (baseline) + 7*60 = 520
    assert t["due_elapsed_minutes"] == 100 + hours * 60
    assert t["payload"]["condition"] == "temporary_insane"
    # an in-session event was emitted
    assert any(ev.get("type") == "recovery_trigger_scheduled" for ev in s.events)


def test_recovery_trigger_due_matches_remaining_hours(campaign):
    """The scheduled due_elapsed must equal now + remaining_hours*60."""
    coc_time.advance_time(campaign, 240, decision_id="d0", reason="4h")
    hours = 3
    seed = _seed_for_bout_duration(hours)
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(seed),
        campaign_dir=campaign)
    s._trigger_temporary_insanity("horror", alone=False, module_bout_override=None)
    state = coc_time.read_time_state(campaign)
    # remaining hours were set on the session
    assert s.temporary_insane_remaining_hours == hours
    trig_data = json.loads((campaign / "save" / "time-triggers.json").read_text())
    t = trig_data["triggers"][0]
    assert t["due_elapsed_minutes"] == 240 + hours * 60


def test_no_trigger_when_campaign_dir_absent(tmp_path):
    """Without campaign_dir, no trigger is scheduled (graceful degradation)."""
    # No campaign_dir -> time layer not used
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(5))
    assert s._schedule_recovery_trigger(7) is None
    # _trigger_temporary_insanity should still work, just not schedule
    s._trigger_temporary_insanity("horror", alone=False, module_bout_override=None)
    assert s.temporary_insane is True


def test_recovery_trigger_initializes_time_state_if_missing(tmp_path):
    """If time-state.json doesn't exist yet, scheduling initializes it."""
    camp = tmp_path / "campaign"
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    # NOTE: deliberately do NOT call initialize_time_state
    hours = 5
    seed = _seed_for_bout_duration(hours)
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(seed),
        campaign_dir=camp)
    trig_id = s._schedule_recovery_trigger(hours)
    assert trig_id is not None
    # time-state was initialized
    assert (camp / "save" / "time-state.json").exists()
    # due = 0 (baseline) + 5*60
    trig_data = json.loads((camp / "save" / "time-triggers.json").read_text())
    assert trig_data["triggers"][0]["due_elapsed_minutes"] == hours * 60


# --------------------------------------------------------------------------- #
# recover_temporary
# --------------------------------------------------------------------------- #
def test_recover_temporary_clears_condition(campaign):
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(1),
        campaign_dir=campaign)
    s.temporary_insane = True
    s.temporary_insane_remaining_hours = 5
    recovered = s.recover_temporary()
    assert recovered is True
    assert s.temporary_insane is False
    assert s.temporary_insane_remaining_hours == 0
    assert any(ev.get("type") == "sanity_recovered" for ev in s.events)


def test_recover_temporary_returns_false_when_not_insane(campaign):
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(1),
        campaign_dir=campaign)
    assert s.recover_temporary() is False


# --------------------------------------------------------------------------- #
# end_day anchor integration
# --------------------------------------------------------------------------- #
def test_end_day_records_day_boundary_when_time_attached(campaign):
    coc_time.advance_time(campaign, 600, decision_id="d0", reason="10h pass")
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(1),
        campaign_dir=campaign)
    s.daily_san_lost = 8
    s.end_day()
    # daily counter reset
    assert s.daily_san_lost == 0
    # sanity period anchor recorded
    state = coc_time.read_time_state(campaign)
    period = state["sanity_periods"]["inv1"]
    assert period["day_started_elapsed"] == 600


def test_end_day_resets_counter_without_time_layer(tmp_path):
    """Without campaign_dir, end_day only resets the daily counter."""
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(1))
    s.daily_san_lost = 8
    s.end_day()
    assert s.daily_san_lost == 0


# --------------------------------------------------------------------------- #
# Full flow: bout -> time passes -> safe rest -> trigger fires -> recover
# --------------------------------------------------------------------------- #
def test_full_flow_trigger_fires_after_safe_rest(campaign):
    """End-to-end: bout schedules trigger; after due time + safe rest it fires."""
    coc_time.advance_time(campaign, 0, decision_id="d0", reason="start")  # baseline 0
    hours = 2
    seed = _seed_for_bout_duration(hours)
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(seed),
        campaign_dir=campaign)
    s._trigger_temporary_insanity("horror", alone=False, module_bout_override=None)
    assert s.temporary_insane is True

    # Advance past the due time (2h = 120 min) but stay unsafe -> deferred
    coc_time.set_unsafe(campaign)
    coc_time.advance_time(campaign, 150, decision_id="d1", reason="2.5h in danger")
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 1  # still pending (unsafe)

    # Now reach a safe place and rest -> trigger fires
    coc_time.mark_safe_rest(campaign, "inv1")
    fired = coc_time.process_due_triggers(campaign)
    assert len(fired) == 1
    assert fired[0]["status"] == "fired"
    assert fired[0]["handler"] == "recover_temporary_insanity"
