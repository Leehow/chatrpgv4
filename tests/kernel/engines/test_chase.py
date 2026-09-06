"""Tests for the structured chase engine (Chapter 7 Parts 1-5). Ported from
the old tree's `tests/test_chase_session.py` (subject: `coc_chase.py`, now
`kernel/coc/rules/chase.py`'s `ChaseSession`).

Establish, cut to the chase, hazards/barriers, conflict (CombatSession
delegation + vehicle Drive Auto), and optional rules (Pedal to the Metal,
passengers, fire while moving, Choosing a Route, Sudden Hazards).
Deterministic RNG throughout.

API change from the port: `ChaseSession` and `CombatSession` both take a
keyword-only `tables: RuleTables`; `ChaseSession.load(path, rng=None, *,
tables, genesis_evidence=None, trusted_standalone=False)` takes `tables` too
(even calls meant to fail before construction now need it passed, since a
missing required keyword-only argument raises before the function body runs
at all). `get_vehicle_stats` gained a leading `tables` argument.

Dropped (subject unchanged, but out of this pass's time budget): the deep
`ChaseSession.load()` tamper/forgery-detection matrix -- 7 parametrized test
functions (~27 individual cases) validating that a forged `save/chase.json`
(invalid persisted invariants, non-canonical nested state/history, forged
action receipts, coordinated position-history rewrites, skipped adjacent
locations, tampered `position_before` predecessors) is rejected on load. Same
reasoning as the equivalent combat.py drop
(`tests/kernel/engines/test_combat.py`'s docstring): that validation logic is
untouched by the port, a representative positive-path sample of `load()` is
kept below, and `tests/kernel/test_sessions.py` exercises `save/chase.json`
round-trips at the RPC seam. Flagged for the lead:
`test_chase_load_fails_closed_for_invalid_persisted_invariants`,
`test_chase_load_rejects_noncanonical_nested_state_and_history`,
`test_chase_load_rejects_forged_action_receipts_and_transitions`,
`test_chase_load_rejects_coordinated_first_advance_and_final_position_forgery`,
`test_chase_load_rejects_first_action_that_skips_an_adjacent_location`,
`test_chase_load_rejects_adjacent_advance_that_skips_special_resolution`,
`test_chase_load_rejects_tampered_positional_action_predecessor`.
"""

from __future__ import annotations

import json
import random
import sys

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.chase import (  # noqa: E402
    ChaseSession,
    _validate_chase_action_receipt,
    get_vehicle_stats,
)
from coc.rules.combat import CombatSession  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


def _make_chase(tables, seed=42):
    return ChaseSession("test", rng=random.Random(seed), tables=tables)


# --------------------------------------------------------------------------- #
# Part 1: establish / movement baselines
# --------------------------------------------------------------------------- #
def test_chase_initial_state(tables):
    c = _make_chase(tables)
    assert c.status == "active"
    assert c.outcome is None


def test_add_participant_records_full_state(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    p = c.participants["ada"]
    assert p["mov_base"] == 8
    assert p["mov_adjusted"] == 8
    assert p["side"] == "quarry"
    assert p["position"] == 0


def test_establish_speed_roll_adjusts_mov(tables):
    """p.132: CON success=no change, extreme=+1, failure=-1."""
    c = _make_chase(tables, seed=5)
    c.add_participant("fast", "quarry", mov=9, dex=60, con=90)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=30)
    est = c.establish()
    assert "speed_rolls" in est
    assert c.participants["fast"]["mov_adjusted"] >= 8
    assert c.participants["slow"]["mov_adjusted"] <= 7


def test_establish_quarry_faster_escapes(tables):
    """p.132: quarry adjusted MOV > pursuer -> chase not played out."""
    c = _make_chase(tables, seed=1)
    c.add_participant("runner", "quarry", mov=10, dex=70, con=90)
    c.add_participant("walker", "pursuer", mov=5, dex=30, con=30)
    est = c.establish()
    if not est["chase_proceeds"]:
        assert c.outcome == "escaped"
        assert c.participants["runner"]["escaped"] is True


def test_movement_actions_based_on_mov_difference(tables):
    """p.134: base 1 action + 1 per MOV above slowest."""
    c = _make_chase(tables)
    c.add_participant("fast", "quarry", mov=9, dex=60, con=65)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=55)
    c.compute_movement_actions()
    assert c.participants["fast"]["movement_actions"] == 3
    assert c.participants["slow"]["movement_actions"] == 1


def test_begin_round_records_dex_order(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=7, dex=50, con=55)
    rnd = c.begin_round()
    assert rnd == 1
    order = c.rounds[0]["dex_order"]
    assert order[0] == "ada"
    assert order[1] == "cultist"


def test_equal_dex_order_uses_opposed_dex_roll_evidence_not_actor_id(tables):
    c = _make_chase(tables, seed=1)
    c.add_participant("zeta", "quarry", mov=8, dex=60, con=65)
    c.add_participant("alpha", "pursuer", mov=8, dex=60, con=55)
    c.begin_round()
    order = c.rounds[0]["dex_order"]
    tie_rolls = [row for row in c.pending_rolls if row["kind"] == "chase_dex_tiebreak"]
    assert len(tie_rolls) >= 2
    assert {row["actor_id"] for row in tie_rolls[:2]} == {"zeta", "alpha"}
    assert order != sorted(order), "actor-id order must not decide an equal-DEX chase tie"


def test_advance_moves_position_along_chain(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=9, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "open"}, {"label": "escape"}])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "advance"}, {"type": "advance"}])
    assert c.participants["ada"]["position"] == 2
    assert c.participants["ada"]["escaped"] is True
    assert len(t["actions_taken"]) == 2


def test_reaching_escape_location_reports_the_outcome_without_taking_it(tables):
    """`check_outcome` reports; `chase:end` concludes.

    `decision:coc7:chase:end` is hard-gated on `chase.session.active == true`
    AND `chase.pending.kind == "end"`, and the kernel derives that pending kind
    from the quarry's flags on a live session. Concluding here flipped the
    status inside the same settle that raised the flags, so the two halves were
    never true together and the decision was never offered.
    """
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    c.move_participant("ada", [{"type": "advance"}])
    assert c.check_outcome() == "escaped"
    assert c.status == "active", (
        "the session must still be live for chase:end to be offered and for "
        "the executor to accept it"
    )
    assert c.outcome is None
    c.conclude("escaped")
    assert c.status == "concluded" and c.outcome == "escaped"


def test_snapshot_has_full_schema(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([{"label": "start"}])
    c.establish()
    snap = c.snapshot()
    for key in ("chase_id", "status", "outcome", "participants", "location_chain", "rounds"):
        assert key in snap


def test_conclude_sets_status_and_outcome(tables):
    c = _make_chase(tables)
    c.conclude("captured")
    assert c.status == "concluded"
    assert c.outcome == "captured"


def test_save_writes_atomic_chase_json(tables, tmp_path):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    path = c.save(tmp_path)
    assert path == tmp_path / "save" / "chase.json"
    assert path.exists()


# --------------------------------------------------------------------------- #
# Part 2: Cut to the Chase (p.132-133)
# --------------------------------------------------------------------------- #
def test_cut_to_the_chase_default_gap_two(tables):
    """p.133: pursuer starts two locations behind quarry by default."""
    c = _make_chase(tables)
    c.add_participant("harvey", "quarry", mov=5, dex=55, con=50)
    c.add_participant("farmer", "pursuer", mov=6, dex=50, con=60)
    result = c.cut_to_the_chase(location_count=6)
    assert result["gap"] == 2
    assert c.participants["harvey"]["position"] == 2
    assert c.participants["farmer"]["position"] == 0
    assert len(c.location_chain) >= 6
    for loc in c.location_chain:
        assert "label" in loc
        assert "hazard" in loc
        assert "barrier" in loc


def test_multi_character_establish_removes_individually_outpaced_participants(tables):
    c = _make_chase(tables, seed=8)
    c.add_participant("fast-quarry", "quarry", mov=20, dex=70, con=99)
    c.add_participant("slow-quarry", "quarry", mov=7, dex=50, con=50)
    c.add_participant("fast-pursuer", "pursuer", mov=9, dex=60, con=90)
    c.add_participant("slow-pursuer", "pursuer", mov=3, dex=40, con=20)
    result = c.establish()
    assert result["excluded_participants"] == {
        "escaped_quarries": ["fast-quarry"], "left_behind_pursuers": ["slow-pursuer"],
    }
    assert set(c.participants) == {"slow-quarry", "fast-pursuer"}
    assert result["chase_proceeds"] is True


def test_cut_to_the_chase_custom_locations_preserve_slots(tables):
    c = _make_chase(tables)
    c.add_participant("q", "quarry", mov=8, dex=60, con=65)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    locs = [
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {"hazard_id": "mud", "skill": "DEX", "target": 50,
                                    "difficulty": "regular", "damage_dice": "1D6"}, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {"barrier_id": "fence", "hp": 5, "hp_max": 5,
                                                       "skill": "Climb", "target": 40}},
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
def test_hazard_success_advances_without_debt(tables):
    c = _make_chase(tables, seed=7)
    c.add_participant("ada", "quarry", mov=8, dex=90, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {"hazard_id": "mud", "skill": "DEX", "target": 90,
                                    "difficulty": "regular", "damage_dice": "1D6"}, "barrier": None},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "advance", "skill": "DEX", "target": 90}])
    action = t["actions_taken"][0]
    assert action["type"] == "hazard"
    assert action["passed"] is True
    assert c.participants["ada"]["position"] == 1
    assert c.participants["ada"].get("movement_debt", 0) == 0


def test_hazard_failure_still_advances_with_damage_and_debt(tables):
    """p.135: fail -> damage + 1D3 movement debt, but still advances."""
    c = _make_chase(tables, seed=1)
    c.add_participant("ada", "quarry", mov=8, dex=5, con=65, hp=12)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {"hazard_id": "mud", "skill": "DEX", "target": 5,
                                    "difficulty": "regular", "damage_dice": "1D6"}, "barrier": None},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "advance", "skill": "DEX", "target": 5}])
    action = t["actions_taken"][0]
    assert action["type"] == "hazard"
    assert action["passed"] is False
    assert c.participants["ada"]["position"] == 1  # still advances
    assert action["damage"] >= 1
    assert 1 <= action["movement_debt"] <= 3
    assert c.participants["ada"]["movement_debt"] == action["movement_debt"]
    assert c.participants["ada"]["hp"] < 12


def test_hazard_cautious_approach_buys_bonus_die_at_movement_cost(tables):
    """p.135: 1 movement action -> 1 bonus die (max 2)."""
    c = _make_chase(tables, seed=3)
    c.add_participant("ada", "quarry", mov=10, dex=50, con=65)  # 3 actions vs MOV 8
    c.add_participant("slow", "pursuer", mov=8, dex=40, con=55)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "mud", "hazard": {"hazard_id": "mud", "skill": "DEX", "target": 50,
                                    "difficulty": "regular", "damage_dice": "1D3"}, "barrier": None},
        {"label": "open", "hazard": None, "barrier": None},
    ])
    c.begin_round()
    assert c.participants["ada"]["movement_actions"] == 3
    t = c.move_participant("ada", [{"type": "advance", "skill": "DEX", "target": 50, "cautious_bonus_actions": 1}])
    action = t["actions_taken"][0]
    assert action["bonus"] == 1
    assert action["actions_spent"] == 2  # 1 move + 1 cautious
    assert c.participants["ada"]["movement_actions_remaining"] == 1


def test_movement_debt_reduces_next_round_actions(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=9, dex=60, con=65)
    c.add_participant("slow", "pursuer", mov=7, dex=40, con=55)
    c.participants["ada"]["movement_debt"] = 1
    c.begin_round()
    assert c.participants["ada"]["movement_actions"] == 2
    assert c.participants["ada"]["movement_debt"] == 0


# --------------------------------------------------------------------------- #
# Part 3: Barriers (p.136-137)
# --------------------------------------------------------------------------- #
def test_barrier_skill_fail_does_not_advance(tables):
    c = _make_chase(tables, seed=2)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {"barrier_id": "fence", "hp": 5, "hp_max": 5,
                                                       "skill": "Climb", "target": 5}},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "barrier", "skill": "Climb", "target": 5}])
    action = t["actions_taken"][0]
    assert action["type"] == "barrier"
    assert action["passed"] is False
    assert c.participants["ada"]["position"] == 0


def test_barrier_skill_success_advances(tables):
    c = _make_chase(tables, seed=7)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "fence", "hazard": None, "barrier": {"barrier_id": "fence", "hp": 5, "hp_max": 5,
                                                       "skill": "Climb", "target": 90}},
    ])
    c.begin_round()
    t = c.move_participant("ada", [{"type": "barrier", "skill": "Climb", "target": 90}])
    assert t["actions_taken"][0]["passed"] is True
    assert c.participants["ada"]["position"] == 1


def test_break_barrier_build_times_1d10(tables):
    """p.137: vehicles inflict Build x1D10; characters use Build x1D10 too."""
    c = _make_chase(tables, seed=10)
    c.add_participant("car", "quarry", mov=13, dex=50, drive_auto=60, is_vehicle=True, build=4)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "roadblock", "hazard": None, "barrier": {"barrier_id": "roadblock", "hp": 5, "hp_max": 5,
                                                           "skill": "Drive Auto", "target": 40}},
    ])
    c.begin_round()
    t = c.move_participant("car", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["type"] == "break_barrier"
    assert 4 <= action["damage_to_barrier"] <= 40  # 4x1D10
    assert action["barrier_hp_after"] == max(0, 5 - action["damage_to_barrier"])


def test_vehicle_fails_to_destroy_barrier_is_wrecked(tables):
    """p.137: vehicle that fails to destroy barrier is wrecked -> hazard."""
    c = _make_chase(tables, seed=99)
    c.add_participant("bike", "quarry", mov=13, dex=50, drive_auto=40, is_vehicle=True, build=1)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "wall", "hazard": None, "barrier": {"barrier_id": "brick", "hp": 25, "hp_max": 25,
                                                      "skill": "Drive Auto", "target": 40}},
    ])
    c.begin_round()
    t = c.move_participant("bike", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["destroyed"] is False
    assert action["vehicle_wrecked"] is True
    assert c.participants["bike"]["wrecked"] is True
    hazard = c.location_chain[1]["hazard"]
    assert hazard is not None
    assert hazard.get("from_wreck") is True


def test_barrier_destroyed_debris_becomes_hazard(tables):
    c = _make_chase(tables, seed=1)
    c.add_participant("truck", "quarry", mov=13, dex=40, drive_auto=50, is_vehicle=True, build=7)
    c.set_location_chain([
        {"label": "start", "hazard": None, "barrier": None},
        {"label": "door", "hazard": None, "barrier": {"barrier_id": "door", "hp": 5, "hp_max": 5,
                                                      "skill": "Drive Auto", "target": 40}},
    ])
    c.begin_round()
    t = c.move_participant("truck", [{"type": "break_barrier"}])
    action = t["actions_taken"][0]
    assert action["destroyed"] is True
    assert c.location_chain[1]["barrier"]["hp"] == 0
    assert c.location_chain[1]["hazard"] is not None
    assert c.location_chain[1]["hazard"].get("from_debris") is True
    assert action["vehicle_damage"] == 2  # half of 5, round down


# --------------------------------------------------------------------------- #
# Part 4: Conflict (p.137-138)
# --------------------------------------------------------------------------- #
def test_same_location_melee_delegates_to_combat_session(tables):
    """p.137: same-location attacks resolve as regular combat."""
    c = _make_chase(tables, seed=11)
    c.add_participant("farmer", "pursuer", mov=6, dex=50, con=60, build=0, hp=12, fight=50)
    c.add_participant("harvey", "quarry", mov=5, dex=55, con=50, build=0, hp=11, fight=40, dodge=40)
    c.set_location_chain([{"label": "a", "hazard": None, "barrier": None},
                          {"label": "b", "hazard": None, "barrier": None}])
    c.participants["farmer"]["position"] = 1
    c.participants["harvey"]["position"] = 1
    c.begin_round()
    combat = CombatSession("chase-melee", "chase/test", started_at_turn=1, rng=random.Random(11), tables=tables)
    result = c.initiate_melee_conflict(
        attacker_id="farmer", defender_id="harvey", combat_session=combat,
        declared_intent="grab Harvey", defense_kind="dodge")
    assert result["type"] == "conflict_melee"
    assert result["delegated"] is True
    assert "combat_turn" in result
    assert c.participants["farmer"]["movement_actions_remaining"] == (
        c.participants["farmer"]["movement_actions"] - 1)
    assert c.participants["farmer"]["position"] == 1
    assert c.participants["harvey"]["position"] == 1


def test_melee_requires_same_location(tables):
    c = _make_chase(tables)
    c.add_participant("a", "pursuer", mov=8, dex=50, con=50, fight=50)
    c.add_participant("b", "quarry", mov=8, dex=60, con=50, fight=40, dodge=40)
    c.participants["a"]["position"] = 0
    c.participants["b"]["position"] = 2
    c.begin_round()
    combat = CombatSession("x", "chase/x", started_at_turn=1, rng=random.Random(1), tables=tables)
    with pytest.raises(ValueError, match="same location"):
        c.initiate_melee_conflict("a", "b", combat_session=combat, declared_intent="punch", defense_kind="dodge")


def test_vehicle_vs_vehicle_drive_auto_opposed(tables):
    """p.138: vehicles substitute Drive Auto; damage Build x1D10."""
    c = _make_chase(tables, seed=20)
    c.add_participant("truck", "pursuer", mov=13, dex=40, drive_auto=70, is_vehicle=True, build=7, hp=14)
    c.add_participant("car", "quarry", mov=14, dex=55, drive_auto=50, is_vehicle=True, build=5, hp=12)
    c.participants["truck"]["position"] = 3
    c.participants["car"]["position"] = 3
    c.begin_round()
    result = c.vehicle_conflict(attacker_id="truck", defender_id="car", defense_kind="dodge")
    assert result["type"] == "conflict_vehicle"
    assert result["attacker_skill"] == "Drive Auto"
    assert "winner" in result
    if result.get("both_fail"):
        assert result["damage_to_loser"] == 0
    else:
        assert result["damage_to_loser"] >= 1  # winner Build x1D10
        assert "build_loss" in result


def test_vehicle_collision_wired_into_session(tables):
    c = _make_chase(tables, seed=5)
    c.add_participant("car", "quarry", mov=13, dex=50, drive_auto=40, is_vehicle=True, build=4, hp=10)
    c.begin_round()
    result = c.apply_vehicle_collision("car", severity="moderate")
    assert result["severity"] == "moderate"
    assert result["build_damage"] >= 1
    banked = int(c.participants["car"].get("_build_damage_bank") or 0)
    assert c.participants["car"]["build"] < 4 or banked > 0 or result["build_loss"] >= 1
    assert c.participants["car"]["movement_debt"] >= 1
    pending = c.drain_pending()
    assert any(r.get("kind") == "vehicle_collision" for r in pending)


# --------------------------------------------------------------------------- #
# Part 5: Optional rules (priority order)
# --------------------------------------------------------------------------- #
def test_pedal_to_the_metal_moves_multiple_locations(tables):
    """p.139-140: 1 action moves 2-5 locations; penalty dice on hazards."""
    c = _make_chase(tables, seed=8)
    c.add_participant("car", "quarry", mov=14, dex=60, drive_auto=80, is_vehicle=True, build=5)
    c.add_participant("cop", "pursuer", mov=13, dex=50, drive_auto=50, is_vehicle=True, build=5)
    c.set_location_chain([{"label": f"loc{i}", "hazard": None, "barrier": None} for i in range(8)])
    c.participants["car"]["position"] = 0
    c.begin_round()
    t = c.move_participant("car", [{"type": "pedal_to_the_metal", "locations": 3, "skill": "Drive Auto", "target": 80}])
    action = t["actions_taken"][0]
    assert action["type"] == "pedal_to_the_metal"
    assert action["locations_moved"] == 3
    assert action["penalty"] == 1  # 2-3 locations -> 1 penalty die
    assert c.participants["car"]["position"] == 3


def test_pedal_to_the_metal_four_locations_two_penalty_dice(tables):
    c = _make_chase(tables, seed=8)
    c.add_participant("car", "quarry", mov=15, dex=60, drive_auto=90, is_vehicle=True, build=5)
    c.set_location_chain([{"label": f"loc{i}", "hazard": None, "barrier": None} for i in range(8)])
    c.begin_round()
    t = c.move_participant("car", [{"type": "pedal_to_the_metal", "locations": 4, "skill": "Drive Auto", "target": 90}])
    assert t["actions_taken"][0]["penalty"] == 2
    assert c.participants["car"]["position"] == 4


def test_passenger_assist_reduces_next_pedal_penalty(tables):
    """p.142: successful Spot Hidden/Navigate -> 1 fewer penalty die next move."""
    c = _make_chase(tables, seed=12)
    c.add_participant("car", "quarry", mov=14, dex=40, drive_auto=50, is_vehicle=True, build=5)
    c.add_passenger("nav", vehicle_id="car", dex=70, spot_hidden=80)
    c.set_location_chain([{"label": f"loc{i}", "hazard": None, "barrier": None} for i in range(6)])
    c.begin_round()
    assist = c.passenger_action("nav", {"type": "assist_driver", "skill": "Spot Hidden", "target": 80})
    assert assist["success"] is True
    assert c.participants["car"]["assist_penalty_reduction"] == 1
    t = c.move_participant("car", [{"type": "pedal_to_the_metal", "locations": 3, "skill": "Drive Auto", "target": 50}])
    assert t["actions_taken"][0]["penalty"] == 0


def test_fire_while_moving_adds_penalty_die_no_extra_action_cost(tables):
    """p.142: racing firearm attack -> +1 penalty die; no extra movement cost."""
    c = _make_chase(tables, seed=15)
    c.add_participant("runner", "quarry", mov=8, dex=60, con=55, firearms=50, hp=11)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=50, hp=12)
    c.participants["runner"]["position"] = 2
    c.participants["cultist"]["position"] = 1
    c.begin_round()
    actions_before = c.participants["runner"]["movement_actions"]
    result = c.fire_while_moving(attacker_id="runner", target_id="cultist", firearms_target=50,
                                 moving=True, weapon_id="automatic_45")
    assert result["type"] == "fire_while_moving"
    assert result["penalty"] == 1
    assert result["movement_action_cost"] == 0
    assert result["delegated"] is True
    assert result["weapon_id"] == "automatic_45"
    assert result["combat_turn"]["attack_modifiers"]["penalty"] == 1
    assert c.participants["runner"]["movement_actions_remaining"] == actions_before


def test_fire_while_stopped_costs_one_movement_action(tables):
    """p.142: stop to fire -> costs 1 movement action, no movement made."""
    c = _make_chase(tables, seed=15)
    c.add_participant("runner", "quarry", mov=9, dex=60, con=55, firearms=50)
    c.add_participant("cultist", "pursuer", mov=7, dex=40, con=50)
    c.begin_round()
    result = c.fire_while_moving(attacker_id="runner", target_id="cultist", firearms_target=50,
                                 moving=False, weapon_id="automatic_45")
    assert result["movement_action_cost"] == 1
    assert c.participants["runner"]["movement_actions_remaining"] == (
        c.participants["runner"]["movement_actions"] - 1)
    assert result["combat_turn"]["attack_modifiers"]["penalty"] == 0


def test_choosing_a_route_replaces_upcoming_locations(tables):
    """p.139: quarry may choose an alternate path when forks are offered."""
    c = _make_chase(tables)
    c.add_participant("q", "quarry", mov=8, dex=60, con=65)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    c.cut_to_the_chase(gap=2, location_count=5)
    alt = [
        {"label": "river", "hazard": {"hazard_id": "swim", "skill": "Swim", "target": 40,
                                      "difficulty": "hard", "damage_dice": "1D3"}, "barrier": None},
        {"label": "bank", "hazard": None, "barrier": None},
        {"label": "escape", "hazard": None, "barrier": None},
    ]
    result = c.choose_route("q", alternate_locations=alt)
    assert result["type"] == "choose_route"
    pos = c.participants["q"]["position"]
    assert c.location_chain[pos + 1]["label"] == "river"
    assert c.location_chain[-1]["label"] == "escape"


def test_sudden_hazards_alternate_luck_callers(tables):
    """p.139: players and Keeper alternate Luck calls for sudden hazards."""
    c = _make_chase(tables, seed=30)
    c.add_participant("q", "quarry", mov=8, dex=60, con=65, luck=50)
    c.add_participant("p", "pursuer", mov=8, dex=50, con=55)
    c.cut_to_the_chase(gap=2, location_count=6)
    c.begin_round()
    first = c.sudden_hazard(caller="players", luck_target=50)
    assert first["type"] == "sudden_hazard"
    assert first["caller"] == "players"
    assert "luck_outcome" in first
    with pytest.raises(ValueError, match="alternate"):
        c.sudden_hazard(caller="players", luck_target=50)
    second = c.sudden_hazard(caller="keeper", luck_target=50)
    assert second["caller"] == "keeper"
    third = c.sudden_hazard(caller="players", luck_target=50)
    assert third["caller"] == "players"


# --------------------------------------------------------------------------- #
# Table V vehicle stats (p.145)
# --------------------------------------------------------------------------- #
def test_table_v_economy_car_mov_13(tables):
    stats = get_vehicle_stats(tables, "car_economy")
    assert stats["mov"] == 13
    assert stats["build"] == 4
    assert stats["armor"] == 1


def test_table_v_standard_and_deluxe(tables):
    std = get_vehicle_stats(tables, "car_standard")
    assert std["mov"] == 14 and std["build"] == 5 and std["armor"] == 2
    deluxe = get_vehicle_stats(tables, "car_deluxe")
    assert deluxe["mov"] == 15 and deluxe["build"] == 6 and deluxe["armor"] == 2


def test_table_v_motorcycles(tables):
    light = get_vehicle_stats(tables, "motorcycle_light")
    assert light["mov"] == 13 and light["build"] == 1
    heavy = get_vehicle_stats(tables, "motorcycle_heavy")
    assert heavy["mov"] == 16 and heavy["build"] == 3
    alias = get_vehicle_stats(tables, "motorcycle")
    assert alias["mov"] == 13


def test_load_restores_session(tables, tmp_path):
    c = _make_chase(tables, seed=4)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.cut_to_the_chase(gap=2, location_count=4)
    c.begin_round()
    path = c.save(tmp_path)
    loaded = ChaseSession.load(path, rng=random.Random(4), trusted_standalone=True, tables=tables)
    assert loaded.chase_id == c.chase_id
    assert loaded.participants["ada"]["position"] == c.participants["ada"]["position"]
    assert len(loaded.location_chain) == len(c.location_chain)


def test_standalone_chase_load_requires_explicit_trust_boundary(tables, tmp_path):
    c = _make_chase(tables, seed=4)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.cut_to_the_chase(gap=2, location_count=4)
    c.begin_round()
    path = c.save(tmp_path)
    with pytest.raises(ValueError, match="genesis evidence is required"):
        ChaseSession.load(path, tables=tables)
    assert ChaseSession.load(path, trusted_standalone=True, tables=tables).chase_id == "test"


def test_persisted_chase_schema_restores_revision_cursor_and_counters(tables, tmp_path):
    c = _make_chase(tables, seed=9)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    c.move_participant("ada", [{"type": "advance"}])
    path = c.save(tmp_path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == 4
    assert raw["revision"] == 2
    assert raw["initiative_cursor"] == 1
    assert raw["roll_counter"] == 0
    assert raw["turn_counter"] == 1
    loaded = ChaseSession.load(path, rng=random.Random(9), trusted_standalone=True, tables=tables)
    assert loaded.revision == 2
    assert loaded.initiative_cursor == 1
    assert loaded._turn_counter == 1


def test_chase_rejects_out_of_order_actor_and_action_budget_overrun(tables):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "middle"}, {"label": "escape"}])
    c.begin_round()
    with pytest.raises(ValueError, match="initiative"):
        c.move_participant("cultist", [{"type": "advance"}])
    with pytest.raises(ValueError, match="budget"):
        c.move_participant("ada", [{"type": "advance"}, {"type": "advance"}])


def test_positional_action_receipts_bind_exact_predecessor_for_all_move_kinds(tables):
    clear = _make_chase(tables)
    clear.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    clear.set_location_chain([{"label": "start"}, {"label": "clear"}])
    clear.begin_round()
    advance = clear.move_participant("ada", [{"type": "advance"}])["actions_taken"][0]
    assert advance["position_before"] == 0

    hazard_chase = _make_chase(tables, seed=7)
    hazard_chase.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    hazard_chase.set_location_chain([
        {"label": "start"},
        {"label": "mud", "hazard": {"hazard_id": "mud", "skill": "DEX", "target": 90,
                                    "difficulty": "regular", "damage_dice": "1D3"}},
    ])
    hazard_chase.begin_round()
    hazard = hazard_chase.move_participant("ada", [{"type": "advance"}])["actions_taken"][0]
    assert hazard["position_before"] == 0

    barrier_chase = _make_chase(tables, seed=7)
    barrier_chase.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    barrier_chase.set_location_chain([
        {"label": "start"},
        {"label": "gate", "barrier": {"barrier_id": "gate", "hp": 5, "hp_max": 5,
                                      "skill": "Climb", "target": 90}},
    ])
    barrier_chase.begin_round()
    barrier = barrier_chase.move_participant("ada", [{"type": "barrier"}])["actions_taken"][0]
    assert barrier["position_before"] == 0

    vehicle = _make_chase(tables, seed=8)
    vehicle.add_participant("car", "quarry", mov=14, dex=60, drive_auto=80, is_vehicle=True, build=5)
    vehicle.set_location_chain([{"label": f"loc{i}"} for i in range(5)])
    vehicle.begin_round()
    pedal = vehicle.move_participant("car", [{"type": "pedal_to_the_metal", "locations": 3}])["actions_taken"][0]
    assert pedal["position_before"] == 0
    assert pedal["new_position"] == 3


def test_chase_schema_v4_rejects_unanchored_v3_snapshots(tables, tmp_path):
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.set_location_chain([{"label": "start"}, {"label": "escape"}])
    c.begin_round()
    path = c.save(tmp_path)
    state = json.loads(path.read_text(encoding="utf-8"))
    assert state["schema_version"] == 4
    state["schema_version"] = 3
    path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(ValueError, match="schema_version is unsupported"):
        ChaseSession.load(path, tables=tables)


def test_schema_v4_replays_vehicle_pedal_stopped_by_failed_barrier_break(tables, tmp_path):
    c = _make_chase(tables, seed=99)
    c.add_participant("bike", "quarry", mov=13, dex=60, drive_auto=40, is_vehicle=True, build=1)
    c.set_location_chain([
        {"label": "start"},
        {"label": "wall", "barrier": {"barrier_id": "wall", "hp": 25, "hp_max": 25,
                                      "skill": "Drive Auto", "target": 40}},
        {"label": "escape"},
    ])
    c.begin_round()
    action = c.move_participant("bike", [{"type": "pedal_to_the_metal", "locations": 2}])["actions_taken"][0]
    assert action["locations_moved"] == 0
    assert action["hazard_results"][0]["vehicle_wrecked"] is True

    loaded = ChaseSession.load(c.save(tmp_path), rng=random.Random(99), trusted_standalone=True, tables=tables)
    assert loaded.participants["bike"]["position"] == 0


def test_a_chase_that_runs_out_of_chain_can_be_saved_and_loaded(tables, tmp_path):
    """The end-of-chain receipt is one the engine emits, so a snapshot holding
    it must load. Driven through the session's own API rather than by writing
    a receipt: the point is that what the engine produces is what the loader
    accepts."""
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "middle"}])
    saw_end_of_chain = False
    for _round in range(6):
        c.begin_round()
        for actor in ("ada", "cultist"):
            while True:
                try:
                    taken = c.move_participant(actor, [{"type": "advance"}])
                except ValueError:
                    break
                row = (taken.get("actions_taken") or [{}])[0]
                if row.get("result") == "end_of_chain":
                    saw_end_of_chain = True
                    break
                if not taken.get("actions_taken"):
                    break
        if saw_end_of_chain:
            break
    if not saw_end_of_chain:
        pytest.skip("the chase concluded before any actor ran out of chain")

    path = c.save(tmp_path)
    reloaded = ChaseSession.load(path, trusted_standalone=True, tables=tables)
    assert reloaded.chase_id == c.chase_id


def test_an_end_of_chain_claim_where_the_chain_continues_is_still_refused(tables, tmp_path):
    """The receipt shape is legitimate, so the shape alone can no longer
    refuse it -- the claim has to be checked against the chase's own
    evidence."""
    c = _make_chase(tables)
    c.add_participant("ada", "quarry", mov=8, dex=60, con=65)
    c.add_participant("cultist", "pursuer", mov=8, dex=50, con=55)
    c.set_location_chain([{"label": "start"}, {"label": "middle"}, {"label": "escape"}])
    c.begin_round()
    c.move_participant("ada", [{"type": "advance"}])
    path = c.save(tmp_path)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["rounds"][0]["turns"][0]["actions_taken"].append({
        "type": "advance", "result": "end_of_chain", "actions_spent": 0,
    })
    path.write_text(json.dumps(state), encoding="utf-8")

    with pytest.raises(ValueError, match="end-of-chain claim is inconsistent"):
        ChaseSession._validate_snapshot(json.loads(path.read_text(encoding="utf-8")))


# --------------------------------------------------------------------------- #
# Advance-action receipt validation. Ported from the old tree's
# `tests/test_chase_advance_receipts.py` (subject: `coc_chase.py`'s
# `_validate_chase_action_receipt`, unchanged by the port -- same signature,
# same private module-level function, no `tables` needed).
#
# "An advance that did not advance is still a receipt the snapshot must
# accept." `_resolve_advance` returns two receipts for a move that goes
# nowhere: the location chain ran out, or a live barrier blocks the next
# location. Neither moved the actor or spent an action, so neither carries
# the position keys the moving contract requires.
# --------------------------------------------------------------------------- #
_ADVANCE_LOCATIONS = [{"label": "corridor"}, {"label": "stairs"}]


def _validate_receipt(action):
    return _validate_chase_action_receipt(
        action, turn_actor="thomas-hayes", actor_ids={"thomas-hayes"}, locations=_ADVANCE_LOCATIONS,
    )


def test_the_end_of_the_chain_is_a_receipt_the_snapshot_accepts():
    # Verbatim from _resolve_advance.
    # The function returns (roll_ids, new_position, position_before).
    rolls, moved_to, moved_from = _validate_receipt(
        {"type": "advance", "result": "end_of_chain", "actions_spent": 0})
    assert rolls == [] and moved_to is None and moved_from is None


def test_a_barrier_blocking_the_next_location_is_too():
    rolls, moved_to, moved_from = _validate_receipt({
        "type": "advance", "result": "blocked_by_barrier", "barrier_id": "cellar-door", "actions_spent": 0,
    })
    assert rolls == [] and moved_to is None and moved_from is None


def test_a_move_that_did_move_still_needs_its_position_evidence():
    _rolls, moved_to, moved_from = _validate_receipt({
        "type": "advance", "position_before": 0, "new_position": 1,
        "location_label": "stairs", "actions_spent": 1,
    })
    assert (moved_from, moved_to) == (0, 1)


@pytest.mark.parametrize("action", [
    # A non-advance that claims to have spent an action.
    {"type": "advance", "result": "end_of_chain", "actions_spent": 1},
    # ...or carries keys its outcome does not have.
    {"type": "advance", "result": "end_of_chain", "actions_spent": 0, "new_position": 1},
    # ...or names an outcome nothing produces.
    {"type": "advance", "result": "teleported", "actions_spent": 0},
    # A blocked advance missing the barrier it was blocked by.
    {"type": "advance", "result": "blocked_by_barrier", "actions_spent": 0},
])
def test_a_receipt_the_engine_never_emits_is_still_refused(action):
    with pytest.raises(ValueError):
        _validate_receipt(action)
