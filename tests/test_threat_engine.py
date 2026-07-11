#!/usr/bin/env python3
"""Tests for the threat-engine: persistent clock state, SAN settlement,
and danger attack profiles driven by the Story Director."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_threat_state  # noqa: E402


# ---------------------------------------------------------------------------
# Task 2: clock tick wired into apply layer
# ---------------------------------------------------------------------------

def _mini_campaign(tmp_path: Path) -> Path:
    """Build a minimal campaign dir with scenario threat-fronts + save state."""
    camp = tmp_path / "campaign"
    (camp / "scenario").mkdir(parents=True)
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    # threat-fronts with a 3-segment clock
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "siege", "scope": "scenario",
                     "clocks": [{"clock_id": "door", "segments": 3,
                                 "on_tick_visible": ["creak", "crack", "gap"],
                                 "on_full": "door breached"}]}],
                     "dangers": []}))
    # minimal world-state + pacing-state
    (camp / "save" / "world-state.json").write_text(json.dumps({"active_scene_id": "s1", "discovered_clue_ids": []}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({"tension_level": "low", "turn_number": 0}))
    return camp


def test_apply_pressure_tick_persists_clock(tmp_path):
    """apply_plan with a pressure_move should tick the clock in threat-state.json."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _mini_campaign(tmp_path)
    plan = {"decision_id": "t1", "scene_action": "PRESSURE",
            "pressure_moves": [{"clock_id": "door", "tick": 1, "visible_symptom": "creak", "reason": "test"}]}
    apply_mod.apply_plan(camp, plan, "inv1")
    state = coc_threat_state.load_threat_state(camp / "save")
    assert state["clocks"]["door"]["current_segments"] == 1
    assert state["clocks"]["door"]["full"] is False


def test_apply_pressure_tick_fires_clock_full_event(tmp_path):
    """When a tick fills a clock, apply emits a clock_full event with on_full text."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _mini_campaign(tmp_path)
    # Pre-fill to 2/3 so one tick fills it
    coc_threat_state.tick_clock(camp / "save", "door", segments=3, source_id="setup:door:1")
    coc_threat_state.tick_clock(camp / "save", "door", segments=3, source_id="setup:door:2")
    assert coc_threat_state.get_clock_segments(camp / "save", "door") == 2

    plan = {"decision_id": "t2", "scene_action": "PRESSURE",
            "pressure_moves": [{"clock_id": "door", "tick": 1, "visible_symptom": "gap", "reason": "test"}]}
    events = apply_mod.apply_plan(camp, plan, "inv1")
    # clock now full
    assert coc_threat_state.is_clock_full(camp / "save", "door")
    # a clock_full event was emitted
    full_events = [e for e in events if e.get("event_type") == "clock_full"]
    assert len(full_events) == 1
    assert "door breached" in full_events[0].get("on_full", "")


# ---------------------------------------------------------------------------
# Task 3: scene on_enter hook (clock ticks on scene entry)
# ---------------------------------------------------------------------------

def _campaign_with_on_enter(tmp_path: Path) -> Path:
    """A campaign where scene-2 has on_enter.clock_ticks."""
    camp = tmp_path / "campaign"
    (camp / "scenario").mkdir(parents=True)
    (camp / "save").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "dramatic_question": "q1", "available_clues": ["c1"],
         "exit_conditions": [], "npc_ids": [], "pressure_moves": [], "tone": [],
         "entry_conditions": [], "allowed_improvisation": []},
        {"scene_id": "s2", "dramatic_question": "q2", "available_clues": [],
         "exit_conditions": [], "npc_ids": [], "pressure_moves": [], "tone": [],
         "entry_conditions": [], "allowed_improvisation": [],
         "on_enter": {"clock_ticks": [{"clock_id": "door", "reason": "entering siege"}]}},
    ]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [{"front_id": "siege", "scope": "scenario",
                     "clocks": [{"clock_id": "door", "segments": 3,
                                 "on_tick_visible": ["creak"], "on_full": "breached"}],
                     "dangers": []}]}))
    (camp / "save" / "world-state.json").write_text(json.dumps(
        {"active_scene_id": "s1", "discovered_clue_ids": ["c1"]}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({"tension_level": "low", "turn_number": 0}))
    return camp


def test_scene_enter_ticks_clock(tmp_path):
    """Advancing into a scene with on_enter.clock_ticks should tick the clock."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_director_apply2", SCRIPTS_DIR / "coc_director_apply.py")
    apply_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apply_mod)

    camp = _campaign_with_on_enter(tmp_path)
    # s1's only clue c1 is already discovered → scene should advance to s2
    plan = {"decision_id": "t1", "scene_action": "REVEAL", "clue_policy": {},
            "rules_requests": [], "pressure_moves": []}
    events = apply_mod.apply_plan(camp, plan, "inv1")

    # scene advanced to s2
    world = json.loads((camp / "save" / "world-state.json").read_text())
    assert world["active_scene_id"] == "s2"
    # a scene_enter event fired
    enter_events = [e for e in events if e.get("event_type") == "scene_enter"]
    assert len(enter_events) == 1
    assert enter_events[0]["to_scene"] == "s2"
    # the door clock was ticked by on_enter
    assert coc_threat_state.get_clock_segments(camp / "save", "door") == 1


# ---------------------------------------------------------------------------
# Task 4: SAN auto-settlement (SanitySession integration in driver)
# ---------------------------------------------------------------------------

def _campaign_and_char_for_san(tmp_path: Path):
    """Build a campaign + character for SAN execution tests."""
    camp = tmp_path / "campaign"
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    char_dir = tmp_path / "inv"
    char_dir.mkdir()
    char = {
        "schema_version": 1, "id": "inv1", "name": "Test", "era": "1920s",
        "characteristics": {"STR": 50, "CON": 50, "SIZ": 50, "DEX": 50, "APP": 50,
                            "INT": 50, "POW": 80, "EDU": 50},
        "derived": {"HP": 10, "MP": 16, "SAN": 80, "MOV": 8, "damage_bonus": 0, "build": 0, "Luck": 50},
        "skills": {"Spot Hidden": 50},
    }
    char_path = char_dir / "character.json"
    char_path.write_text(json.dumps(char), encoding="utf-8")
    (camp / "save" / "world-state.json").write_text(json.dumps(
        {"active_scene_id": "s1", "discovered_clue_ids": [], "san_triggers_fired": []}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({"tension_level": "low", "turn_number": 0}))
    # investigator-state for SanitySession sync target
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps(
        {
            "investigator_id": "inv1",
            "current_san": 80,
            "indefinite_insane": False,
        }))
    return camp, char_path


def test_sanity_check_settles_san_loss(tmp_path):
    """A sanity_check request with san_loss params should deduct SAN via SanitySession."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_playtest_driver_san", SCRIPTS_DIR / "coc_playtest_driver.py")
    drv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(drv)

    camp, char_path = _campaign_and_char_for_san(tmp_path)
    import random
    rng = random.Random(99)  # deterministic
    plan = {"decision_id": "san1", "rules_requests": [
        {"kind": "sanity_check", "skill": "SAN", "reason": "seeing the carnage",
         "difficulty": "regular", "bonus_penalty_dice": 0,
         "san_loss_success": 0, "san_loss_fail_expr": "1",
         "source": "the blast chamber carnage", "creature_type": None}]}
    results = drv._execute_rules_requests(camp, char_path, "inv1", plan, rng)

    assert len(results) == 2
    r = next(row for row in results if row.get("kind") == "sanity_check")
    assert any(row.get("event_type") == "sanity" for row in results)
    assert r["kind"] == "sanity_check"
    # SAN loss field present
    assert "san_loss" in r
    assert "san_after" in r
    # investigator-state was synced with new SAN
    inv = json.loads((camp / "save" / "investigator-state" / "inv1.json").read_text())
    assert inv["current_san"] == r["san_after"]
    assert inv["current_san"] <= 80  # lost some (or 0 on success, but <=80 always)


# ---------------------------------------------------------------------------
# Task 5: director emits scene-level SAN request from on_enter.san_triggers
# ---------------------------------------------------------------------------

def test_director_emits_san_request_for_scene_with_san_triggers(tmp_path):
    """_build_rules_requests should emit a sanity_check when the active scene
    has on_enter.san_triggers that haven't been fired yet."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_story_director_san", SCRIPTS_DIR / "coc_story_director.py")
    director = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(director)

    scene = {"scene_id": "blast-chamber", "on_enter": {"san_triggers": [
        {"trigger_id": "carnage", "source": "the blast chamber carnage",
         "san_loss_success": 0, "san_loss_fail_expr": "1", "tag": "violence"}]}}
    ctx = {
        "active_scene": scene, "active_scene_id": "blast-chamber",
        "rule_signals": {"bout_active": False, "sanity_state": "stable",
                         "hp_state": "healthy", "stalled_turns": 0},
        "player_intent_class": "investigate",
        "world_state": {"discovered_clue_ids": [], "san_triggers_fired": []},
        "threat_fronts": {"fronts": []}, "clue_graph": {"conclusions": []},
        "module_meta": {}, "story_graph": {"scenes": [scene]},
        "npc_agendas": {"npcs": []}, "pacing_state": {},
        "player_intent_rich": None, "investigator_id": "inv1",
        "time_signals": {}, "sanity_engine_state": None, "chase_state": None,
    }
    requests = director._build_rules_requests(ctx, "REVEAL", {"clue_type": "obvious"})
    san_reqs = [r for r in requests if r.get("kind") == "sanity_check"]
    assert len(san_reqs) == 1
    assert san_reqs[0]["san_loss_success"] == 0
    assert san_reqs[0]["san_loss_fail_expr"] == "1"
    assert "carnage" in san_reqs[0]["source"]


def test_director_skips_san_request_already_fired(tmp_path):
    """Once a san_trigger is in san_triggers_fired, it should not re-fire."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_story_director_san2", SCRIPTS_DIR / "coc_story_director.py")
    director = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(director)

    scene = {"scene_id": "blast-chamber", "on_enter": {"san_triggers": [
        {"trigger_id": "carnage", "source": "carnage",
         "san_loss_success": 0, "san_loss_fail_expr": "1"}]}}
    ctx = {
        "active_scene": scene, "active_scene_id": "blast-chamber",
        "rule_signals": {"bout_active": False, "sanity_state": "stable",
                         "hp_state": "healthy", "stalled_turns": 0},
        "player_intent_class": "investigate",
        "world_state": {"discovered_clue_ids": [], "san_triggers_fired": ["carnage"]},
        "threat_fronts": {"fronts": []}, "clue_graph": {"conclusions": []},
        "module_meta": {}, "story_graph": {"scenes": [scene]},
        "npc_agendas": {"npcs": []}, "pacing_state": {},
        "player_intent_rich": None, "investigator_id": "inv1",
        "time_signals": {}, "sanity_engine_state": None, "chase_state": None,
    }
    requests = director._build_rules_requests(ctx, "REVEAL", {"clue_type": "obvious"})
    san_reqs = [r for r in requests if r.get("kind") == "sanity_check"]
    assert len(san_reqs) == 0  # already fired, skip


# ---------------------------------------------------------------------------
# Task 6: danger attack_profiles → opposed_check requests
# ---------------------------------------------------------------------------

def test_director_emits_opposed_check_for_combat_danger(tmp_path):
    """In a combat scene with danger attack_profiles, director should emit
    opposed_check requests (e.g. Dodge vs tentacle slash)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_story_director_atk", SCRIPTS_DIR / "coc_story_director.py")
    director = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(director)

    scene = {"scene_id": "dawn-counterstroke", "scene_type": "combat",
             "on_enter": {"danger_attacks": [{"danger_id": "the-whistler",
                "attack_name": "tentacle slash"}]}}
    threat_fronts = {"fronts": [{"front_id": "polyp-horror-pursuit", "dangers": [
        {"id": "the-whistler", "attack_profiles": [
            {"name": "tentacle slash", "attack_skill": "Fighting", "attack_target_percent": 60,
             "resist_skill": "Dodge", "damage": "1D6+DB", "lethality": 50}]}]}]}
    ctx = {
        "active_scene": scene, "active_scene_id": "dawn-counterstroke",
        "rule_signals": {"bout_active": False, "sanity_state": "stable",
                         "hp_state": "healthy", "stalled_turns": 0},
        "player_intent_class": "fight",
        "world_state": {"discovered_clue_ids": [], "san_triggers_fired": []},
        "threat_fronts": threat_fronts, "clue_graph": {"conclusions": []},
        "module_meta": {}, "story_graph": {"scenes": [scene]},
        "npc_agendas": {"npcs": []}, "pacing_state": {},
        "player_intent_rich": None, "investigator_id": "inv1",
        "time_signals": {}, "sanity_engine_state": None, "chase_state": None,
    }
    requests = director._build_rules_requests(ctx, "SUBSYSTEM")
    opposed = [r for r in requests if r.get("kind") == "opposed_check"]
    assert len(opposed) >= 1
    assert opposed[0]["resist_skill"] == "Dodge"
    assert "tentacle" in opposed[0]["reason"].lower() or "tentacle" in opposed[0].get("attack_name","").lower()


# ---------------------------------------------------------------------------
# Task 1: threat-state.json persistence layer
# ---------------------------------------------------------------------------

def _save_with_clocks(tmp_path: Path, clocks: dict) -> Path:
    """Write a threat-state.json with the given clock states. Returns the save dir."""
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    state = {"schema_version": 1, "clocks": clocks}
    (save / "threat-state.json").write_text(json.dumps(state), encoding="utf-8")
    return save


def test_load_threat_state_returns_empty_when_missing(tmp_path):
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"] == {}


def test_tick_clock_increments_and_persists(tmp_path):
    save = _save_with_clocks(tmp_path, {"siege-door": {"current_segments": 1, "full": False}})
    coc_threat_state.tick_clock(save, "siege-door", segments=4, source_id="test:siege:1")
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["siege-door"]["current_segments"] == 2
    assert state["clocks"]["siege-door"]["full"] is False


def test_tick_clock_detects_full(tmp_path):
    save = _save_with_clocks(tmp_path, {"siege-door": {"current_segments": 3, "full": False}})
    became_full = coc_threat_state.tick_clock(save, "siege-door", segments=4, source_id="test:siege:full")
    assert became_full is True
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["siege-door"]["full"] is True
    assert state["clocks"]["siege-door"]["current_segments"] == 4


def test_tick_clock_does_not_exceed_segments(tmp_path):
    """A full clock should not tick past its segment count."""
    save = _save_with_clocks(tmp_path, {"entity": {"current_segments": 6, "full": True}})
    became_full = coc_threat_state.tick_clock(save, "entity", segments=6, source_id="test:entity:full")
    # Already full — tick is a no-op, returns False (did not *become* full this tick)
    assert became_full is False
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["entity"]["current_segments"] == 6


def test_tick_clock_unknown_creates_entry(tmp_path):
    """Ticking a clock that has no saved state starts from 0 then increments."""
    save = _save_with_clocks(tmp_path, {})
    became_full = coc_threat_state.tick_clock(save, "new-clock", segments=4, source_id="test:new-clock:1")
    assert became_full is False
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["new-clock"]["current_segments"] == 1
    assert state["clocks"]["new-clock"]["full"] is False


def test_get_clock_segments_returns_live_or_zero(tmp_path):
    """Merge helper: return live current_segments from threat-state, or 0."""
    save = _save_with_clocks(tmp_path, {"known": {"current_segments": 2, "full": False}})
    assert coc_threat_state.get_clock_segments(save, "known") == 2
    assert coc_threat_state.get_clock_segments(save, "unknown") == 0


def test_effect_receipt_detects_clock_tampering_and_fails_closed(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    applied, _ = coc_threat_state.apply_clock_effect_once(
        save, "doom", 6, ticks=2, effect_id="pushed-consequence:resolve-1"
    )
    assert applied is True
    path = save / "threat-state.json"
    state = json.loads(path.read_text())
    state["clocks"]["doom"]["current_segments"] = 5
    state["clocks"]["doom"]["full"] = False
    path.write_text(json.dumps(state))

    with pytest.raises(ValueError, match="transition|clock"):
        coc_threat_state.load_threat_state(save)


def test_effect_retry_after_legitimate_clock_mutation_is_noop(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    effect_id = "pushed-consequence:resolve-2"
    assert coc_threat_state.apply_clock_effect_once(
        save, "doom", 6, ticks=2, effect_id=effect_id
    ) == (True, False)
    assert coc_threat_state.tick_clock(save, "doom", 6, source_id="test:doom:later") is False

    assert coc_threat_state.apply_clock_effect_once(
        save, "doom", 6, ticks=2, effect_id=effect_id
    ) == (False, False)
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["doom"]["current_segments"] == 3
    assert len(state["transitions"]) == 2


def test_effect_receipt_binds_exact_persisted_transition(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    effect_id = "pushed-consequence:resolve-3"
    coc_threat_state.apply_clock_effect_once(
        save, "doom", 6, ticks=2, effect_id=effect_id
    )
    path = save / "threat-state.json"
    state = json.loads(path.read_text())
    state["applied_effects"][effect_id]["after_segments"] = 4
    path.write_text(json.dumps(state))

    with pytest.raises(ValueError, match="receipt|transition"):
        coc_threat_state.load_threat_state(save)


def test_independent_transaction_ledger_rejects_two_tick_state_truncation(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:tick:1")
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:tick:2")
    path = save / "threat-state.json"
    state = json.loads(path.read_text())
    state["transitions"] = state["transitions"][:1]
    state["clocks"]["doom"] = {"current_segments": 1, "full": False}
    state["ledger_head"] = state["transitions"][-1]["transition_hash"]
    state["applied_effects"].pop("test:tick:2")
    path.write_text(json.dumps(state))
    with pytest.raises(ValueError, match="independent|transaction|ledger"):
        coc_threat_state.load_threat_state(save)


@pytest.mark.parametrize("tamper", ["clock", "head", "recomputed_chain"])
def test_independent_transaction_ledger_rejects_coordinated_clock_chain_rewrite(
    tmp_path, tamper,
):
    save = _save_with_clocks(tmp_path, {})
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:rewrite:1")
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:rewrite:2")
    path = save / "threat-state.json"
    state = json.loads(path.read_text())
    if tamper == "clock":
        state["clocks"]["doom"]["current_segments"] = 1
    elif tamper == "head":
        state["ledger_head"] = "0" * 64
    else:
        state["transitions"][1]["ticks"] = 2
        state["transitions"][1]["after_segments"] = 3
        state["transitions"][1]["previous_hash"] = state["transitions"][0]["transition_hash"]
        state["transitions"][1]["transition_hash"] = coc_threat_state._transition_hash(
            state["transitions"][1]
        )
        state["clocks"]["doom"] = {"current_segments": 3, "full": False}
        state["ledger_head"] = state["transitions"][1]["transition_hash"]
        receipt = state["applied_effects"]["test:rewrite:2"]
        receipt.update({
            "ticks": 2,
            "after_segments": 3,
            "transition_hash": state["ledger_head"],
        })
    path.write_text(json.dumps(state))
    with pytest.raises(ValueError):
        coc_threat_state.load_threat_state(save)


def test_ordinary_tick_source_retry_is_exact_noop(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    assert coc_threat_state.tick_clock(save, "doom", 6, source_id="test:retry") is False
    assert coc_threat_state.tick_clock(save, "doom", 6, source_id="test:retry") is False
    state = coc_threat_state.load_threat_state(save)
    assert state["clocks"]["doom"]["current_segments"] == 1
    assert len(state["transitions"]) == 1


def test_pending_transaction_journal_recovers_log_ahead_of_state(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:crash:1")
    old_state = coc_threat_state.load_threat_state(save)
    next_state = json.loads(json.dumps(old_state))
    transition = coc_threat_state._append_transition(
        next_state, kind="effect", clock_id="doom", segments=6,
        ticks=2, source_id="test:crash:2",
    )
    next_state["applied_effects"]["test:crash:2"] = (
        coc_threat_state._transition_receipt(transition)
    )
    rows = coc_threat_state._read_transaction_ledger(save)
    record = {
        "record_type": "threat_clock_transaction",
        "sequence": 2,
        "source_id": "test:crash:2",
        "previous_receipt_hash": rows[-1]["receipt_hash"],
        "transition": transition,
    }
    material = json.dumps(record, sort_keys=True, separators=(",", ":"))
    record["receipt_hash"] = hashlib.sha256(material.encode()).hexdigest()
    ledger_path = coc_threat_state._ledger_path(save)
    with ledger_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
    coc_threat_state.coc_fileio.write_json_atomic(
        coc_threat_state._pending_path(save),
        {"transition_hash": transition["transition_hash"],
         "receipt_hash": record["receipt_hash"]},
        indent=2, ensure_ascii=False, trailing_newline=True,
    )

    recovered = coc_threat_state.load_threat_state(save)
    assert recovered["clocks"]["doom"]["current_segments"] == 3
    assert recovered["ledger_head"] == transition["transition_hash"]
    assert not coc_threat_state._pending_path(save).exists()


def test_pending_first_transaction_recovers_from_genesis_before_state_write(tmp_path):
    save = tmp_path / "campaign" / "save"
    save.mkdir(parents=True)
    next_state = coc_threat_state._empty_state()
    transition = coc_threat_state._append_transition(
        next_state, kind="tick", clock_id="doom", segments=6,
        ticks=1, source_id="test:first-crash",
    )
    next_state["applied_effects"]["test:first-crash"] = (
        coc_threat_state._transition_receipt(transition)
    )
    record = {
        "record_type": "threat_clock_transaction",
        "sequence": 1,
        "source_id": "test:first-crash",
        "previous_receipt_hash": "0" * 64,
        "transition": transition,
    }
    material = json.dumps(record, sort_keys=True, separators=(",", ":"))
    import hashlib
    record["receipt_hash"] = hashlib.sha256(material.encode()).hexdigest()
    ledger = coc_threat_state._ledger_path(save)
    ledger.parent.mkdir(parents=True)
    ledger.write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
    coc_threat_state.coc_fileio.write_json_atomic(
        coc_threat_state._pending_path(save),
        {"transition_hash": transition["transition_hash"],
         "receipt_hash": record["receipt_hash"]},
        indent=2, ensure_ascii=False, trailing_newline=True,
    )

    recovered = coc_threat_state.load_threat_state(save)

    assert recovered == next_state
    assert json.loads((save / "threat-state.json").read_text()) == next_state
    assert not coc_threat_state._pending_path(save).exists()


def test_missing_snapshot_with_transaction_ledger_but_no_journal_fails_closed(tmp_path):
    save = _save_with_clocks(tmp_path, {})
    coc_threat_state.tick_clock(save, "doom", 6, source_id="test:ledger-only")
    (save / "threat-state.json").unlink()

    with pytest.raises(ValueError, match="transaction|ledger|snapshot"):
        coc_threat_state.load_threat_state(save)


def test_completely_absent_threat_persistence_starts_at_genesis(tmp_path):
    save = tmp_path / "campaign" / "save"
    save.mkdir(parents=True)

    assert coc_threat_state.load_threat_state(save) == coc_threat_state._empty_state()


def test_init_threat_state_creates_file(tmp_path):
    """Initialization creates an empty threat-state.json."""
    save = tmp_path / "save"
    save.mkdir(parents=True, exist_ok=True)
    coc_threat_state.init_threat_state(save)
    assert (save / "threat-state.json").exists()
    state = json.loads((save / "threat-state.json").read_text())
    assert state["clocks"] == {}
