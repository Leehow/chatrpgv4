"""System fixes: supersede settlements, skill ownership, development faces, time order."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_combat
import coc_development
import coc_runtime_ops as coc_runtime
import coc_turn_finalization as coc_turn


def test_render_public_roll_uses_die_rolls_not_empty_face():
    line = coc_turn._render_public_roll({
        "skill": "SAN Reward",
        "kind": "scenario_san_reward",
        "die": "1D6",
        "die_rolls": [6],
        "roll": 6,
        "outcome": "sanity_reward",
    })
    assert "骰面 —" not in line
    assert "骰面 6" in line
    assert "总值 6" in line
    assert "1D6" in line


def test_is_player_facing_roll_hides_superseded():
    assert coc_turn.is_player_facing_roll({"visibility": "public", "roll_id": "a"})
    assert not coc_turn.is_player_facing_roll({
        "visibility": "superseded", "roll_id": "b", "superseded": True,
    })
    assert not coc_turn.is_player_facing_roll({
        "visibility": "public", "player_facing": False, "roll_id": "c",
    })


def test_device_attack_skill_owner_does_not_tick_investigator():
    # Remote device: no living skill owner.
    remote = {
        "skill": "Fighting (Brawl)",
        "outcome": "regular_success",
        "success": True,
        "executor_kind": "remote_device",
        "skill_owner_id": None,
        "action_designer_id": "thomas-hayes",
        "actor_id": "poltergeist-bed",
    }
    assert coc_development.skill_owner_for_roll(remote) is None
    assert not coc_development.skill_tick_eligible("Fighting (Brawl)", remote)

    living = {
        "skill": "Fighting (Brawl)",
        "outcome": "regular_success",
        "success": True,
        "actor_id": "thomas-hayes",
        "skill_owner_id": "thomas-hayes",
        "executor_kind": "living",
        "kind": "combat_skill",
    }
    assert coc_development.skill_owner_for_roll(living) == "thomas-hayes"
    assert coc_development.skill_tick_eligible("Fighting (Brawl)", living)


def test_stamp_skill_ownership_on_remote_weapon():
    record: dict = {"actor_id": "corbitt", "skill": "Fighting (Brawl)"}
    coc_combat.CombatSession._stamp_skill_ownership(
        record,
        actor_id="corbitt",
        weapon={
            "weapon_id": "poltergeist-bed",
            "remote": True,
            "skill": "Fighting (Brawl)",
            "action_designer_id": "walter-corbitt",
        },
    )
    assert record["executor_kind"] == "remote_device"
    assert record["skill_owner_id"] is None
    assert record["action_designer_id"] == "walter-corbitt"
    assert record.get("improvement_tick_eligible") is False


def test_time_state_deltas_ordered_by_elapsed():
    # Insert later advance first to force reordering.
    effects = [
        {
            "effect_kind": "time",
            "before": 60,
            "after": 90,
            "delta_minutes": 30,
            "source_decision_id": "later",
        },
        {
            "effect_kind": "scalar",
            "resource": "HP",
            "before": 12,
            "after": 11,
        },
        {
            "effect_kind": "time",
            "before": 0,
            "after": 60,
            "delta_minutes": 60,
            "source_decision_id": "earlier",
        },
    ]
    ordered = coc_turn._order_state_deltas_chronologically(effects)
    time_rows = [row for row in ordered if row["effect_kind"] == "time"]
    assert [row["before"] for row in time_rows] == [0, 60]
    # Non-time rows keep relative position among themselves.
    assert ordered[1]["resource"] == "HP"


def test_compose_development_player_facing_requires_all_public_checks():
    operation_id = "op-development-settle-demo"
    result = {
        "improvement_checks": [
            {
                "skill": "Listen",
                "check_roll": 60,
                "value_before": 45,
                "value_after": 48,
                "improved": True,
                "gain": 3,
            },
            {
                "skill": "Spot Hidden",
                "check_roll": 12,
                "value_before": 55,
                "value_after": 55,
                "improved": False,
            },
        ],
        "luck_recovery": {
            "roll": 75,
            "success": True,
            "gained": 7,
            "luck_before": 33,
            "luck_after": 40,
        },
    }
    rows = []
    for index, check in enumerate(result["improvement_checks"]):
        rows.append({
            "roll_id": f"{operation_id}:check:{index}",
            "payload": {
                "roll_id": f"{operation_id}:check:{index}",
                "skill": check["skill"],
                "kind": "development_check",
                "die": "1D100",
                "die_rolls": [check["check_roll"]],
                "roll": check["check_roll"],
                "target": check["value_before"],
                "outcome": "improved" if check["improved"] else "no_improvement",
            },
        })
        if check.get("improved"):
            rows.append({
                "roll_id": f"{operation_id}:gain:{index}",
                "payload": {
                    "roll_id": f"{operation_id}:gain:{index}",
                    "skill": check["skill"],
                    "kind": "development_gain",
                    "die": "1D10",
                    "die_rolls": [check["gain"]],
                    "roll": check["gain"],
                    "outcome": "skill_increased",
                },
            })
    rows.append({
        "roll_id": f"{operation_id}:luck-recovery",
        "payload": {
            "roll_id": f"{operation_id}:luck-recovery",
            "skill": "Luck",
            "kind": "luck_recovery",
            "die": "1D100",
            "die_rolls": [75],
            "roll": 75,
            "outcome": "recovered",
        },
    })
    facing = coc_runtime._compose_development_player_facing(
        investigator_id="thomas-hayes",
        operation_id=operation_id,
        result=result,
        public_rows=rows,
    )
    assert facing["complete"] is True
    assert len(facing["required_roll_ids"]) == 4
    assert len(facing["rendered_lines"]) == 4
    text = facing["rendered_text"]
    assert "【明骰】" in text
    assert "Listen" in text
    assert "75" in text

    incomplete = coc_runtime._compose_development_player_facing(
        investigator_id="thomas-hayes",
        operation_id=operation_id,
        result=result,
        public_rows=rows[:1],  # only first check written
    )
    assert incomplete["complete"] is False
    assert incomplete["missing_roll_ids"]
