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


@pytest.fixture
def campaign_with_inv(campaign):
    """A campaign with a seeded investigator-state for inv1."""
    inv_dir = campaign / "save" / "investigator-state"
    inv_dir.mkdir(parents=True, exist_ok=True)
    (inv_dir / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11,
        "conditions": [], "indefinite_insane": False,
    }), encoding="utf-8")
    return campaign


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
def test_full_flow_trigger_fires_after_safe_rest(campaign_with_inv):
    """End-to-end: bout schedules trigger; after due time + safe rest the
    handler actually runs recover_temporary() and clears the condition."""
    campaign = campaign_with_inv
    coc_time.advance_time(campaign, 0, decision_id="d0", reason="start")  # baseline 0
    hours = 2
    seed = _seed_for_bout_duration(hours)
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(seed),
        campaign_dir=campaign)
    s._trigger_temporary_insanity("horror", alone=False, module_bout_override=None)
    assert s.temporary_insane is True
    s.save(campaign)  # persist so the handler can rebuild the session

    # Advance past the due time (2h = 120 min) but stay unsafe -> deferred
    coc_time.set_unsafe(campaign)
    coc_time.advance_time(campaign, 150, decision_id="d1", reason="2.5h in danger")
    due = coc_time.peek_due_triggers(campaign)
    assert len(due) == 1  # still pending (unsafe)

    # Now reach a safe place and rest -> trigger fires AND the handler runs
    coc_time.mark_safe_rest(campaign, "inv1")
    fired = coc_time.process_due_triggers(campaign)
    assert len(fired) == 1
    assert fired[0]["status"] == "fired"
    assert fired[0]["handler"] == "recover_temporary_insanity"
    # The handler actually executed recover_temporary() and reported it.
    assert fired[0].get("dispatch_outcome", {}).get("recovered") is True
    # And the persisted snapshot reflects the cleared condition.
    snap = json.loads((campaign / "save" / "sanity.json").read_text(encoding="utf-8"))
    assert snap["temporary_insane"] is False


# --------------------------------------------------------------------------- #
# Handler dispatch: treatment trigger + indefinite insanity recovery
# --------------------------------------------------------------------------- #
def test_indefinite_insanity_schedules_weekly_treatment(campaign):
    """Triggering indefinite insanity schedules a weekly treatment trigger."""
    s = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(1),
        campaign_dir=campaign)
    s._trigger_indefinite_insanity()
    triggers = coc_time._read_json(coc_time._triggers_path(campaign))["triggers"]
    treatment = [t for t in triggers if t.get("handler") == "apply_psychoanalysis_treatment"]
    assert len(treatment) == 1
    assert treatment[0]["policy"] == "auto_apply_if_safe"
    assert treatment[0]["payload"]["condition"] == "indefinite_insane"
    # Due ~1 week (7*24*60 = 10080 min) from now (elapsed 0).
    assert treatment[0]["due_elapsed_minutes"] == 7 * 24 * 60


def test_treatment_handler_dispatch_recovers_san(campaign_with_inv):
    """When the weekly treatment trigger fires, PsychotherapySession runs and
    the recovered SAN is written back to investigator-state."""
    campaign = campaign_with_inv
    # Seed an investigator in indefinite insanity with a Psychoanalysis skill.
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv["current_san"] = 40
    inv["max_san"] = 60
    inv["indefinite_insane"] = True
    inv["psychoanalysis_skill"] = 70  # high skill → likely success
    inv_path.write_text(json.dumps(inv), encoding="utf-8")

    # Schedule a treatment trigger due now.
    coc_time.schedule_trigger(campaign, {
        "kind": "treatment", "scope": "investigator", "target_id": "inv1",
        "due_elapsed_minutes": 0, "policy": "auto_apply",
        "handler": "apply_psychoanalysis_treatment",
        "payload": {"condition": "indefinite_insane"},
    })
    coc_time.mark_safe_rest(campaign, "inv1")
    fired = coc_time.process_due_triggers(campaign)
    assert len(fired) == 1
    outcome = fired[0].get("dispatch_outcome", {})
    # SAN moved (recovered >= 0; with skill 70 it should usually gain).
    assert "san_after" in outcome
    inv_after = json.loads(inv_path.read_text(encoding="utf-8"))
    assert inv_after["current_san"] == outcome["san_after"]
    assert inv_after["current_san"] >= 40  # never lost SAN from treatment success


def test_treatment_updates_identity_snapshot_without_claiming_party_legacy(
    campaign_with_inv,
):
    campaign = campaign_with_inv
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({
        "current_san": 60,
        "max_san": 60,
        "indefinite_insane": True,
        "psychoanalysis_skill": 1,
    })
    inv_path.write_text(json.dumps(inv), encoding="utf-8")

    legacy_owner = coc_sanity.SanitySession(
        "inv2", san_max=50, int_value=50, rng=random.Random(10),
        campaign_dir=campaign,
    )
    legacy_path = campaign / "save" / "sanity.json"
    legacy_path.write_text(
        json.dumps(legacy_owner.snapshot()), encoding="utf-8"
    )
    legacy_before = legacy_path.read_bytes()
    inv1_sanity = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(11),
        campaign_dir=campaign,
    )
    inv1_sanity.san_current = 60
    inv1_sanity.indefinite_insane = True
    inv1_sanity.save(campaign)
    assert legacy_path.read_bytes() == legacy_before

    outcome = coc_time._handler_apply_treatment(campaign, "inv1", {})
    canonical = json.loads(
        coc_sanity.sanity_snapshot_path(campaign, "inv1").read_text(
            encoding="utf-8"
        )
    )
    assert outcome["fully_restored"] is True
    assert canonical["san_current"] == 60
    assert canonical["indefinite_insane"] is False
    assert legacy_path.read_bytes() == legacy_before


def test_partial_treatment_updates_canonical_san_and_preserves_indefinite(
    campaign_with_inv,
):
    campaign = campaign_with_inv
    inv_path = campaign / "save" / "investigator-state" / "inv1.json"
    inv = json.loads(inv_path.read_text(encoding="utf-8"))
    inv.update({
        "current_san": 40,
        "max_san": 60,
        "indefinite_insane": True,
        "psychoanalysis_skill": 100,
    })
    inv_path.write_text(json.dumps(inv), encoding="utf-8")
    sanity = coc_sanity.SanitySession(
        "inv1", san_max=60, int_value=50, rng=random.Random(101),
        campaign_dir=campaign,
    )
    sanity.san_current = 40
    sanity.indefinite_insane = True
    sanity.save(campaign)

    outcome = coc_time._handler_apply_treatment(campaign, "inv1", {})
    reloaded = coc_sanity.SanitySession.load(
        campaign, "inv1", rng=random.Random(102)
    )
    inv_after = json.loads(inv_path.read_text(encoding="utf-8"))

    assert outcome["fully_restored"] is False
    assert outcome["san_after"] > 40
    assert reloaded.san_current == outcome["san_after"]
    assert inv_after["current_san"] == outcome["san_after"]
    assert reloaded.indefinite_insane is True
    assert inv_after["indefinite_insane"] is True


def test_handler_dispatch_failure_does_not_block_time(campaign_with_inv, monkeypatch):
    """A handler that raises must not block time advance; the error is recorded."""
    campaign = campaign_with_inv

    def boom(*args, **kwargs):
        raise RuntimeError("simulated handler crash")
    # Sabotage the lazy loader so _dispatch_handler blows up.
    monkeypatch.setattr(coc_time, "_load_sibling_script", boom)

    coc_time.schedule_trigger(campaign, {
        "kind": "treatment", "scope": "investigator", "target_id": "inv1",
        "due_elapsed_minutes": 0, "policy": "auto_apply",
        "handler": "apply_psychoanalysis_treatment", "payload": {},
    })
    # Time advance must still complete despite the handler crash.
    result = coc_time.advance_time(campaign, 10, decision_id="d1", reason="move on")
    fired = result["fired_triggers"]
    assert len(fired) == 1
    assert fired[0]["status"] == "fired"
    assert "RuntimeError" in fired[0].get("dispatch_error", "")
