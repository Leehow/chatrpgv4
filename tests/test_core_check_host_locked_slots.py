"""The host may fill only the slots a decision declares.

`decision:coc7:core-check:opposed-check` names its actor `investigator_target`
and declares no `investigator_id`. The adapter set `investigator_id` for every
core-check settle regardless, so every opposed settle was refused with
"host-locked input 'investigator_id' is not a declared slot" -- a refusal
projected to the Keeper as its own argument error, for an argument the Keeper
never sent and cannot withdraw. Across 167 diagnostic lanes the decision had
never once settled.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins" / "coc-keeper" / "scripts"))
sys.path.insert(0, str(ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"))

import rule_graph_adapter  # noqa: E402

OPPOSED = "decision:coc7:core-check:opposed-check"
COMBINED = "decision:coc7:core-check:combined-check"
ORDINARY = "decision:coc7:core-check:ordinary-check"
LUCK = "decision:coc7:push-luck:luck-roll"

SHEET = {
    "skills": [{"name": "Fighting (Brawl)", "value": 55}],
    "characteristics": {"STR": 60},
}


def _provider(semantic):
    """The real provider, with the sheet/NPC lookups its caller injects."""
    return rule_graph_adapter.Coc7RuleGraphAdapter.host_locked_provider(
        object(),
        {},
        {"semantic_inputs": semantic},
        resolve_investigator=lambda ctx, args: "thomas-hayes",
        safe_sheet=lambda ctx, investigator: SHEET,
        skill_value=lambda sheet, name: 55,
    )


def test_opposed_check_declares_a_target_not_an_investigator_id():
    """Read from the shipped graph rather than asserted from memory: this is
    the asymmetry the adapter has to respect."""
    opposed = rule_graph_adapter._declared_payload_slots(OPPOSED)
    assert "investigator_id" not in opposed
    assert "investigator_target" in opposed
    for other in (COMBINED, ORDINARY, LUCK):
        assert "investigator_id" in rule_graph_adapter._declared_payload_slots(other)


def test_the_host_never_fills_a_slot_opposed_check_does_not_declare():
    """The defect itself: every key the provider returns must be declared."""
    locked = _provider({
        "actor_check_ref": "skill:fighting-brawl",
        "opponent_check_ref": "npc:npc-walter-corbitt",
    })(OPPOSED)
    declared = rule_graph_adapter._declared_payload_slots(OPPOSED)
    undeclared = sorted(set(locked) - declared)
    assert not undeclared, (
        f"the host filled slots opposed-check does not declare: {undeclared}"
    )
    assert "investigator_id" not in locked


@pytest.mark.parametrize("decision,semantic", [
    (ORDINARY, {"skill": "Spot Hidden"}),
    (COMBINED, {"combined_target_refs": ["skill:fighting-brawl"]}),
    (LUCK, {}),
])
def test_the_decisions_that_do_declare_it_still_get_it(decision, semantic):
    """The gate must not cost the other three core-check decisions the slot
    they legitimately need."""
    locked = _provider(semantic)(decision)
    assert locked.get("investigator_id") == "thomas-hayes"
    declared = rule_graph_adapter._declared_payload_slots(decision)
    assert not sorted(set(locked) - declared)
