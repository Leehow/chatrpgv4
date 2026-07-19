"""Focused deterministic public-roll rendering contracts."""
from __future__ import annotations

import importlib.util
from pathlib import Path


CONTRACT_PATH = Path("plugins/coc-keeper/scripts/coc_narration_contract.py")


def _contract(name: str):
    spec = importlib.util.spec_from_file_location(name, CONTRACT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_public_amount_rolls_render_by_role_once_without_percentile_target():
    contract = _contract("coc_narration_contract_amount_roles")
    amounts = [
        {
            "roll_id": "armor-1",
            "roll_role": "amount",
            "visibility": "public",
            "skill": "Flesh Ward Armor",
            "rolled_total": 7,
            "dice": {"expression": "2D6", "raw": [3, 4], "total": 7},
            "outcome": "armor_prepared",
        },
        {
            "roll_id": "damage-1",
            "roll_role": "amount",
            "visibility": "consequence_public",
            "skill": "HP Damage",
            "target_actor_id": "inv1",
            "rolled_total": 5,
            "dice": {"expression": "1D6", "raw": [5], "total": 5},
            "outcome": "damage_applied",
        },
        {
            "roll_id": "healing-1",
            "roll_role": "amount",
            "visibility": "public",
            "skill": "HP Healing",
            "rolled_total": 2,
            "dice": {"expression": "1D3", "raw": [2], "total": 2},
            "outcome": "healing_applied",
        },
        {
            "roll_id": "san-reward-1",
            "roll_role": "amount",
            "visibility": "public",
            "skill": "SAN Reward",
            "rolled_total": 4,
            "dice": {"expression": "1D6", "raw": [4], "total": 4},
            "outcome": "sanity_reward",
        },
    ]

    block = contract.build_rules_owned_public_roll_block(
        [*amounts, amounts[0]], decision_id="amount-render"
    )

    assert block["public_roll_count"] == 4
    assert [entry["roll_id"] for entry in block["entries"]] == [
        "armor-1", "damage-1", "healing-1", "san-reward-1",
    ]
    assert all(entry["roll_role"] == "amount" for entry in block["entries"])
    assert all("roll" not in entry and "target" not in entry for entry in block["entries"])
    assert block["text"].count("【明骰】") == 4
    assert block["text"].count("Flesh Ward Armor") == 1


def test_public_luck_roll_renders_raw_spend_adjusted_and_context_once():
    contract = _contract("coc_narration_contract_luck_sequence")
    raw = {
        "roll_id": "luck-roll-1",
        "roll_role": "percentile_check",
        "visibility": "public",
        "skill": "Dodge",
        "roll": 30,
        "original_roll": 35,
        "adjusted_roll": 30,
        "luck_spent": 5,
        "required_level": "hard",
        "difficulty": "hard",
        "required_target": 30,
        "effective_target": 30,
        "achieved_level": "hard",
        "passed": True,
        "outcome": "hard",
    }

    block = contract.build_rules_owned_public_roll_block(
        [raw], decision_id="luck-render"
    )

    assert block["public_roll_count"] == 1
    assert block["text"].count("原始 35") == 1
    assert block["text"].count("幸运-5") == 1
    assert block["text"].count("调整 30") == 1
    assert block["text"].count("困难成功") == 1
    assert block["entries"][0]["original_roll"] == 35
    assert block["entries"][0]["adjusted_roll"] == 30
