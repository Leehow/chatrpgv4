"""Tests for the structured chase engine (coc_chase.ChaseSession).

Chapter 7 Parts 1-5: establish, cut to the chase, hazards/barriers,
conflict (CombatSession delegation + vehicle Drive Auto), and optional
rules (Pedal to the Metal, passengers, fire while moving, Choosing a
Route, Sudden Hazards). Deterministic RNG throughout.
"""
from __future__ import annotations

import importlib.util
import random
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


coc_chase = _load("coc_chase", "plugins/coc-keeper/scripts/coc_chase.py")
coc_combat = _load("coc_combat", "plugins/coc-keeper/scripts/coc_combat.py")


def _make_chase(seed=42):
    return coc_chase.ChaseSession("test", rng=random.Random(seed))


# --------------------------------------------------------------------------- #
# Existing Part 1 / movement baselines
# --------------------------------------------------------------------------- #
def test_chase_initial_state():
    c = _make_chase()
    assert c.status == "active"
    assert c.outcome is None


def test_add_participant_records_full_state():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    p = c.participants["ada"]
    assert p["mov_base"] == 8
    assert p["mov_adjusted"] == 8
    assert p["side"] == "quarry"
    assert p["position"] == 0


def test_establish_speed_roll_adjusts_mov():
    """p.132: CON success=no change, extreme=+1, failure=-1."""
    c = _make_chase(seed=5)
    c.add_participant("fast", "quarry", mov=9, dex=60, con=90)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=30)
    est = c.establish()
    assert "speed_rolls" in est
    assert c.participants["fast"]["mov_adjusted"] >= 8
    assert c.participants["slow"]["mov_adjusted"] <= 7


def test_establish_quarry_faster_escapes():
    """p.132: quarry adjusted MOV > pursuer → chase not played out."""
    c = _make_chase(seed=1)
    c.add_participant("runner", "quarry", mov=10, dex=70, con=90)
    c.add_participant("walker", "pursuer", mov=5, dex=30, con=30)
    est = c.establish()
    if not est["chase_proceeds"]:
        assert c.outcome == "escaped"
        assert c.participants["runner"]["escaped"] is True


def test_movement_actions_based_on_mov_difference():
    """p.134: base 1 action + 1 per MOV above slowest."""
    c = _make_chase()
    c.add_participant("fast", "quarry", mov=9, dex=60, con=65)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=55)
    c.compute_movement_actions()
    assert c.participants["fast"]["movement_actions"] == 3
    assert c.participants["slow"]["movement_actions"] == 1


def test_begin_round_records_dex_order():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=7, dex=50, con=55)
    rnd = c.begin_round()
    assert rnd == 1
    order = c.rounds[0]["dex_order"]
    assert order[0] == "ada"
    assert order[1] == "cultist"


def test_advance_moves_position_along_chain():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=9, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=55)
    c.set_location_chain([
        {"label": "start"}, {"label": "open"}, {"label": "escape"}])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "advance"}, {"type": "advance"}])
    assert c.participants["ada"]["position"] == 2
    assert c.participants["ada"]["escaped"] is True
    assert len(t["actions_taken"]) == 2


def test_reaching_escape_location_ends_chase():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    c.move_participant("ada", [{"type": "advance"}])
    c.check_outcome()
    assert c.outcome == "escaped"


def test_snapshot_has_full_schema():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([{"label": "start"}])
    c.establish()
    snap = c.snapshot()
    for key in ("chase_id", "status", "outcome", "participants",
                "location_chain", "rounds"):
        assert key in snap


def test_conclude_sets_status_and_outcome():
    c = _make_chase()
    c.conclude("captured")
    assert c.status == "concluded"
    assert c.outcome == "captured"


def test_save_writes_atomic_chase_json(tmp_path):
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    path = c.save(tmp_path)
    assert path == tmp_path / "save" / "chase.json"
    assert path.exists()


# --------------------------------------------------------------------------- #
# Part 2: Cut to the Chase (p.132-133)
# --------------------------------------------------------------------------- #
def test_cut_to_the_chase_default_gap_two():
    """p.133: pursuer starts two locations behind quarry by default."""
    c = _make_chase()
    c.add_participant("harvey", "quarry", mov=5, dex=55, con=50)
    c.add_participant("farmer", "pursuer", mov=6, dex=50, con=60)
    result = c.cut_to_the_chase(location_count=6)
    assert result["gap"] == 2
    assert c.participants["harvey"]["position"] == 2
    assert c.participants["farmer"]["position"] == 0
    assert len(c.location_chain) >= 6
    # Structured entries with optional hazard/barrier slots.
    for loc in c.location_chain:
        assert "label" in loc
        assert "hazard" in loc
        assert "barrier" in loc


def test_cut_to_the_chase_custom_locations_preserve_slots():
    c = _make_chase()
    c.add_participant("q", "quarry", mov=8, dex=60, con=65)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    locs = [
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {
            "hazard_id": "mud", "skill": "DEX", "target": 50,
            "difficulty": "regular", "damage_dice": "1D6",
        }, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {
            "barrier_id": "fence", "hp": 5, "hp_max": 5,
            "skill": "Climb", "target": 40,
        }},
        {"label": "escape", "hazard": None, "barrier": None},
    ]
    c.cut_to_the_chase(gap=2, locations=locs)
    assert c.location_chain[1]["hazard"]["hazard_id"] == "mud"
    assert c.location_chain[2]["barrier"]["hp"] == 5
    assert c.participants["q"]["position"] == 2
    assert c.participants["p"]["position"] == 0


# --------------------------------------------------------------------------- #
# Part 3: Hazards (p.134-135)
# --------------------------------------------------------------------------- #
def test_hazard_success_advances_without_debt():
    c = _make_chase(seed=7)
    c.add_participant("ada", "quarry", mov=8, dex=90, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {
            "hazard_id": "mud", "skill": "DEX", "target": 90,
            "difficulty": "regular", "damage_dice": "1D6",
        }, "barrier": None},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{
        "type": "advance", "skill": "DEX", "target": 90,
    }])
    action = t["actions_taken"][0]
    assert action["type"] == "hazard"
    assert action["passed"] is True
    assert c.participants["ada"]["position"] == 1
    assert c.participants["ada"].get("movement_debt", 0) == 0


def test_hazard_failure_still_advances_with_damage_and_debt():
    """p.135: fail → damage + 1D3 movement debt, but still advances."""
    c = _make_chase(seed=1)
    c.add_participant("ada", "quarry", mov=8, dex=5, con=65, hp=12)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {
            "hazard_id": "mud", "skill": "DEX", "target": 5,
            "difficulty": "regular", "damage_dice": "1D6",
        }, "barrier": None},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{
        "type": "advance", "skill": "DEX", "target": 5,
    }])
    action = t["actions_taken"][0]
    assert action["type"] == "hazard"
    assert action["passed"] is False
    assert c.participants["ada"]["position"] == 1  # still advances
    assert action["damage"] >= 1
    assert 1 <= action["movement_debt"] <= 3
    assert c.participants["ada"]["movement_debt"] == action["movement_debt"]
    assert c.participants["ada"]["hp"] < 12


def test_hazard_cautious_approach_buys_bonus_die_at_movement_cost():
    """p.135: 1 movement action → 1 bonus die (max 2)."""
    c = _make_chase(seed=3)
    c.add_participant("ada", "quarry", mov=10, dex=50, con=65)  # 3 actions vs MOV 8
    c.add_participant("slow", "pursuer", mov=8, dex=40, con=55)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {
            "hazard_id": "mud", "skill": "DEX", "target": 50,
            "difficulty": "regular", "damage_dice": "1D3",
        }, "barrier": None},
        {"label": "open", "hazard": None, "barrier": None},
    ])
    c.begin_round()
    assert c.participants["ada"]["movement_actions"] == 3
    t = c.move_participant("ada", [{
        "type": "advance", "skill": "DEX", "target": 50,
        "cautious_bonus_actions": 1,
    }])
    action = t["actions_taken"][0]
    assert action["bonus"] == 1
    assert action["actions_spent"] == 2  # 1 move + 1 cautious
    # Remaining actions after this: 3 - 2 = 1
    assert c.participants["ada"]["movement_actions_remaining"] == 1


def test_movement_debt_reduces_next_round_actions():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=9, dex=60, con=65)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=55)
    c.participants["ada"]["movement_debt"] = 1
    c.begin_round()
    # Would be 3 actions; debt of 1 → 2
    assert c.participants["ada"]["movement_actions"] == 2
    assert c.participants["ada"]["movement_debt"] == 0


# --------------------------------------------------------------------------- #
# Part 3: Barriers (p.136-137)
# --------------------------------------------------------------------------- #
def test_barrier_skill_fail_does_not_advance():
    c = _make_chase(seed=2)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {
            "barrier_id": "fence", "hp": 5, "hp_max": 5,
            "skill": "Climb", "target": 5,
        }},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{
        "type": "barrier", "skill": "Climb", "target": 5,
    }])
    action = t["actions_taken"][0]
    assert action["type"] == "barrier"
    assert action["passed"] is False
    assert c.participants["ada"]["position"] == 0


def test_barrier_skill_success_advances():
    c = _make_chase(seed=7)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {
            "barrier_id": "fence", "hp": 5, "hp_max": 5,
            "skill": "Climb", "target": 90,
        }},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{
        "type": "barrier", "skill": "Climb", "target": 90,
    }])
    assert t["actions_taken"][0]["passed"] is True
    assert c.participants["ada"]["position"] == 1


def test_break_barrier_build_times_1d10():
    """p.137: vehicles inflict Build×1D10; characters use Build×1D10 too."""
    c = _make_chase(seed=10)
    c.add_participant("car", "quarry", mov=13, dex=50, drive_auto=60,
                      is_vehicle=True, build=4)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "roadblock", "hazard": None, "barrier": {
            "barrier_id": "roadblock", "hp": 5, "hp_max": 5,
            "skill": "Drive Auto", "target": 40,
        }},
    ])
    c.begin_round()
    t = c.move_participant("car", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["type"] == "break_barrier"
    assert 4 <= action["damage_to_barrier"] <= 40  # 4×1D10
    assert action["barrier_hp_after"] == max(0, 5 - action["damage_to_barrier"])


def test_vehicle_fails_to_destroy_barrier_is_wrecked():
    """p.137: vehicle that fails to destroy barrier is wrecked → hazard."""
    c = _make_chase(seed=99)
    # Build 1 → max 10 damage; barrier HP 25 → cannot destroy in one hit
    c.add_participant("bike", "quarry", mov=13, dex=50, drive_auto=40,
                      is_vehicle=True, build=1)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "wall", "hazard": None, "barrier": {
            "barrier_id": "brick", "hp": 25, "hp_max": 25,
            "skill": "Drive Auto", "target": 40,
        }},
    ])
    c.begin_round()
    t = c.move_participant("bike", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["destroyed"] is False
    assert action["vehicle_wrecked"] is True
    assert c.participants["bike"]["wrecked"] is True
    # Wreck becomes a hazard at the barrier location.
    hazard = c.location_chain[1]["hazard"]
    assert hazard is not None
    assert hazard.get("from_wreck") is True


def test_barrier_destroyed_debris_becomes_hazard():
    c = _make_chase(seed=1)
    c.add_participant("truck", "quarry", mov=13, dex=40, drive_auto=50,
                      is_vehicle=True, build=7)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "door", "hazard": None, "barrier": {
            "barrier_id": "door", "hp": 5, "hp_max": 5,
            "skill": "Drive Auto", "target": 40,
        }},
    ])
    c.begin_round()
    t = c.move_participant("truck", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["destroyed"] is True
    assert c.location_chain[1]["barrier"]["hp"] == 0
    assert c.location_chain[1]["hazard"] is not None
    assert c.location_chain[1]["hazard"].get("from_debris") is True
    # Vehicle takes half barrier HP prior to impact (p.137).
    assert action["vehicle_damage"] == 2  # half of 5, round down


# --------------------------------------------------------------------------- #
# Part 4: Conflict (p.137-138)
# --------------------------------------------------------------------------- #
def test_same_location_melee_delegates_to_combat_session():
    """p.137: same-location attacks resolve as regular combat."""
    c = _make_chase(seed=11)
    c.add_participant("farmer", "pursuer", mov=6, dex=50, con=60,
                      build=0, hp=12, fight=50)
    c.add_participant("harvey", "quarry", mov=5, dex=55, con=50,
                      build=0, hp=11, fight=40, dodge=40)
    c.set_location_chain([
        {"label": "a", "hazard": None, "barrier": None},
        {"label": "b", "hazard": None, "barrier": None},
    ])
    c.participants["farmer"]["position"] = 1
    c.participants["harvey"]["position"] = 1
    c.begin_round()
    combat = coc_combat.CombatSession(
        "chase-melee", "chase/test", started_at_turn=1, rng=random.Random(11),
    )
    result = c.initiate_melee_conflict(
        attacker_id="farmer",
        defender_id="harvey",
        combat_session=combat,
        declared_intent="grab Harvey",
        defense_kind="dodge",
    )
    assert result["type"] == "conflict_melee"
    assert result["delegated"] is True
    assert "combat_turn" in result
    # Farmer MOV 6 vs Harvey 5 → 2 actions; melee costs 1.
    assert c.participants["farmer"]["movement_actions_remaining"] == (
        c.participants["farmer"]["movement_actions"] - 1
    )
    # Chase owns positions; combat owns the exchange.
    assert c.participants["farmer"]["position"] == 1
    assert c.participants["harvey"]["position"] == 1


def test_melee_requires_same_location():
    c = _make_chase()
    c.add_participant("a", "pursuer", mov=8, dex=50, con=50, fight=50)
    c.add_participant("b", "quarry", mov=8, dex=60, con=50, fight=40, dodge=40)
    c.participants["a"]["position"] = 0
    c.participants["b"]["position"] = 2
    c.begin_round()
    combat = coc_combat.CombatSession(
        "x", "chase/x", started_at_turn=1, rng=random.Random(1),
    )
    with pytest.raises(ValueError, match="same location"):
        c.initiate_melee_conflict(
            "a", "b", combat_session=combat,
            declared_intent="punch", defense_kind="dodge",
        )


def test_vehicle_vs_vehicle_drive_auto_opposed():
    """p.138: vehicles substitute Drive Auto; damage Build×1D10."""
    c = _make_chase(seed=20)
    c.add_participant("truck", "pursuer", mov=13, dex=40, drive_auto=70,
                      is_vehicle=True, build=7, hp=14)
    c.add_participant("car", "quarry", mov=14, dex=55, drive_auto=50,
                      is_vehicle=True, build=5, hp=12)
    c.participants["truck"]["position"] = 3
    c.participants["car"]["position"] = 3
    c.begin_round()
    result = c.vehicle_conflict(
        attacker_id="truck",
        defender_id="car",
        defense_kind="dodge",  # Drive Auto as Dodge
    )
    assert result["type"] == "conflict_vehicle"
    assert result["attacker_skill"] == "Drive Auto"
    assert "winner" in result
    if result.get("both_fail"):
        assert result["damage_to_loser"] == 0
    else:
        assert result["damage_to_loser"] >= 1  # winner Build×1D10
        assert "build_loss" in result


def test_vehicle_collision_wired_into_session():
    c = _make_chase(seed=5)
    c.add_participant("car", "quarry", mov=13, dex=50, drive_auto=40,
                      is_vehicle=True, build=4, hp=10)
    c.begin_round()
    result = c.apply_vehicle_collision("car", severity="moderate")
    assert result["severity"] == "moderate"
    assert result["build_damage"] >= 1
    # Build drops only per full 10 HP (p.145); remainder banks.
    banked = int(c.participants["car"].get("_build_damage_bank") or 0)
    assert c.participants["car"]["build"] < 4 or banked > 0 or result["build_loss"] >= 1
    assert c.participants["car"]["movement_debt"] >= 1
    pending = c.drain_pending()
    assert any(r.get("kind") == "vehicle_collision" for r in pending)


# --------------------------------------------------------------------------- #
# Part 5: Optional rules (priority order)
# --------------------------------------------------------------------------- #
def test_pedal_to_the_metal_moves_multiple_locations():
    """p.139-140: 1 action moves 2-5 locations; penalty dice on hazards."""
    c = _make_chase(seed=8)
    c.add_participant("car", "quarry", mov=14, dex=60, drive_auto=80,
                      is_vehicle=True, build=5)
    c.add_participant("cop", "pursuer", mov=13, dex=50, drive_auto=50,
                      is_vehicle=True, build=5)
    c.set_location_chain([
        {"label": f"loc{i}", "hazard": None, "barrier": None}
        for i in range(8)
    ])
    c.participants["car"]["position"] = 0
    c.begin_round()
    t = c.move_participant("car", [{
        "type": "pedal_to_the_metal", "locations": 3,
        "skill": "Drive Auto", "target": 80,
    }])
    action = t["actions_taken"][0]
    assert action["type"] == "pedal_to_the_metal"
    assert action["locations_moved"] == 3
    assert action["penalty"] == 1  # 2-3 locations → 1 penalty die
    assert c.participants["car"]["position"] == 3


def test_pedal_to_the_metal_four_locations_two_penalty_dice():
    c = _make_chase(seed=8)
    c.add_participant("car", "quarry", mov=15, dex=60, drive_auto=90,
                      is_vehicle=True, build=5)
    c.set_location_chain([
        {"label": f"loc{i}", "hazard": None, "barrier": None}
        for i in range(8)
    ])
    c.begin_round()
    t = c.move_participant("car", [{
        "type": "pedal_to_the_metal", "locations": 4,
        "skill": "Drive Auto", "target": 90,
    }])
    assert t["actions_taken"][0]["penalty"] == 2
    assert c.participants["car"]["position"] == 4


def test_passenger_assist_reduces_next_pedal_penalty():
    """p.142: successful Spot Hidden/Navigate → 1 fewer penalty die next move."""
    c = _make_chase(seed=12)
    c.add_participant("car", "quarry", mov=14, dex=40, drive_auto=50,
                      is_vehicle=True, build=5)
    c.add_passenger("nav", vehicle_id="car", dex=70, spot_hidden=80)
    c.set_location_chain([
        {"label": f"loc{i}", "hazard": None, "barrier": None}
        for i in range(6)
    ])
    c.begin_round()
    # Passenger acts (no movement actions of their own).
    assist = c.passenger_action("nav", {
        "type": "assist_driver", "skill": "Spot Hidden", "target": 80,
    })
    assert assist["success"] is True
    assert c.participants["car"]["assist_penalty_reduction"] == 1
    t = c.move_participant("car", [{
        "type": "pedal_to_the_metal", "locations": 3,
        "skill": "Drive Auto", "target": 50,
    }])
    # Base penalty 1 for 3 locations, minus assist → 0
    assert t["actions_taken"][0]["penalty"] == 0


def test_fire_while_moving_adds_penalty_die_no_extra_action_cost():
    """p.142: racing firearm attack → +1 penalty die; no extra movement cost."""
    c = _make_chase(seed=15)
    c.add_participant("runner", "quarry", mov=8, dex=60, con=55,
                      firearms=50, hp=11)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=50, hp=12)
    c.participants["runner"]["position"] = 2
    c.participants["cultist"]["position"] = 1
    c.begin_round()
    actions_before = c.participants["runner"]["movement_actions"]
    result = c.fire_while_moving(
        attacker_id="runner",
        target_id="cultist",
        firearms_target=50,
        moving=True,
    )
    assert result["type"] == "fire_while_moving"
    assert result["penalty"] == 1
    # Does not consume an extra movement action beyond what's already spent.
    assert result["movement_action_cost"] == 0
    assert c.participants["runner"]["movement_actions_remaining"] == actions_before


def test_fire_while_stopped_costs_one_movement_action():
    """p.142: stop to fire → costs 1 movement action, no movement made."""
    c = _make_chase(seed=15)
    c.add_participant("runner", "quarry", mov=9, dex=60, con=55, firearms=50)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=50)
    c.begin_round()
    result = c.fire_while_moving(
        attacker_id="runner",
        target_id="cultist",
        firearms_target=50,
        moving=False,
    )
    assert result["movement_action_cost"] == 1
    assert c.participants["runner"]["movement_actions_remaining"] == (
        c.participants["runner"]["movement_actions"] - 1
    )


def test_choosing_a_route_replaces_upcoming_locations():
    """p.139: quarry may choose an alternate path when forks are offered."""
    c = _make_chase()
    c.add_participant("q", "quarry", mov=8, dex=60, con=65)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    c.cut_to_the_chase(gap=2, location_count=5)
    alt = [
        {"label": "river", "hazard": {
            "hazard_id": "swim", "skill": "Swim", "target": 40,
            "difficulty": "hard", "damage_dice": "1D3",
        }, "barrier": None},
        {"label": "bank", "hazard": None, "barrier": None},
        {"label": "escape", "hazard": None, "barrier": None},
    ]
    result = c.choose_route("q", alternate_locations=alt)
    assert result["type"] == "choose_route"
    # Locations at/behind current position preserved; ahead replaced.
    pos = c.participants["q"]["position"]
    assert c.location_chain[pos + 1]["label"] == "river"
    assert c.location_chain[-1]["label"] == "escape"


def test_sudden_hazards_alternate_luck_callers():
    """p.139: players and Keeper alternate Luck calls for sudden hazards."""
    c = _make_chase(seed=30)
    c.add_participant("q", "quarry", mov=8, dex=60, con=65, luck=50)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    c.cut_to_the_chase(gap=2, location_count=6)
    c.begin_round()
    first = c.sudden_hazard(caller="players", luck_target=50)
    assert first["type"] == "sudden_hazard"
    assert first["caller"] == "players"
    assert "luck_outcome" in first
    # Same side cannot call again until the other side has.
    with pytest.raises(ValueError, match="alternate"):
        c.sudden_hazard(caller="players", luck_target=50)
    second = c.sudden_hazard(caller="keeper", luck_target=50)
    assert second["caller"] == "keeper"
    # Now players may call again.
    third = c.sudden_hazard(caller="players", luck_target=50)
    assert third["caller"] == "players"


# --------------------------------------------------------------------------- #
# Table V vehicle stats (p.145)
# --------------------------------------------------------------------------- #
def test_table_v_economy_car_mov_13():
    stats = coc_chase.get_vehicle_stats("car_economy")
    assert stats["mov"] == 13
    assert stats["build"] == 4
    assert stats["armor"] == 1


def test_table_v_standard_and_deluxe():
    std = coc_chase.get_vehicle_stats("car_standard")
    assert std["mov"] == 14 and std["build"] == 5 and std["armor"] == 2
    deluxe = coc_chase.get_vehicle_stats("car_deluxe")
    assert deluxe["mov"] == 15 and deluxe["build"] == 6 and deluxe["armor"] == 2


def test_table_v_motorcycles():
    light = coc_chase.get_vehicle_stats("motorcycle_light")
    assert light["mov"] == 13 and light["build"] == 1
    heavy = coc_chase.get_vehicle_stats("motorcycle_heavy")
    assert heavy["mov"] == 16 and heavy["build"] == 3
    # Alias "motorcycle" → light
    alias = coc_chase.get_vehicle_stats("motorcycle")
    assert alias["mov"] == 13


def test_load_restores_session(tmp_path):
    c = _make_chase(seed=4)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.cut_to_the_chase(gap=2, location_count=4)
    c.begin_round()
    path = c.save(tmp_path)
    loaded = coc_chase.ChaseSession.load(path, rng=random.Random(4))
    assert loaded.chase_id == c.chase_id
    assert loaded.participants["ada"]["position"] == c.participants["ada"]["position"]
    assert len(loaded.location_chain) == len(c.location_chain)


def test_persisted_chase_schema_restores_revision_cursor_and_counters(tmp_path):
    c = _make_chase(seed=9)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    c.move_participant("ada", [{"type": "advance"}])
    path = c.save(tmp_path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == 3
    assert raw["revision"] == 2
    assert raw["initiative_cursor"] == 1
    assert raw["roll_counter"] == 0
    assert raw["turn_counter"] == 1
    loaded = coc_chase.ChaseSession.load(path, rng=random.Random(9))
    assert loaded.revision == 2
    assert loaded.initiative_cursor == 1
    assert loaded._turn_counter == 1


def test_chase_rejects_out_of_order_actor_and_action_budget_overrun():
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "middle"}, {"label": "escape"}])
    c.begin_round()
    with pytest.raises(ValueError, match="initiative"):
        c.move_participant("cultist", [{"type": "advance"}])
    with pytest.raises(ValueError, match="budget"):
        c.move_participant("ada", [{"type": "advance"}, {"type": "advance"}])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda state: state.update({"schema_version": 99}),
        lambda state: state.update({"revision": -1}),
        lambda state: state.update({"initiative_cursor": 99}),
        lambda state: state["participants"][0].update({"movement_actions_remaining": -1}),
        lambda state: state["rounds"][0].update({"dex_order": ["unknown"]}),
    ],
)
def test_chase_load_fails_closed_for_invalid_persisted_invariants(tmp_path, mutate):
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    path = c.save(tmp_path)
    state = json.loads(path.read_text(encoding="utf-8"))
    mutate(state)
    path.write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(ValueError, match="chase snapshot"):
        coc_chase.ChaseSession.load(path)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["participants"][0].update({"extra": True}),
        lambda s: s["participants"][0].update({"side": "keeper"}),
        lambda s: s["participants"][0].update({"hp": -1}),
        lambda s: s["participants"][0].update({"conditions": ["invented"]}),
        lambda s: s["location_chain"][0].update({"extra": True}),
        lambda s: s["location_chain"][0].update({"hazard": {"hazard_id": "h", "extra": True}}),
        lambda s: s["location_chain"][0].update({"barrier": {"barrier_id": "b", "hp": 1, "hp_max": 1, "extra": True}}),
        lambda s: s["rounds"][0]["turns"].append({"turn_id": "forged", "actor_id": "unknown"}),
        lambda s: s.update({"revision": 99}),
        lambda s: s.update({"turn_counter": 99}),
    ],
)
def test_chase_load_rejects_noncanonical_nested_state_and_history(tmp_path, mutate):
    c = _make_chase()
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65, conditions=["unconscious"])
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    path = c.save(tmp_path)
    state = json.loads(path.read_text(encoding="utf-8"))
    mutate(state)
    path.write_text(json.dumps(state), encoding="utf-8")
    with pytest.raises(ValueError, match="chase snapshot"):
        coc_chase.ChaseSession.load(path)
