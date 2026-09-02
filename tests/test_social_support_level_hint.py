"""A support claim recorded at no level must say so.

`supporting_action.level` defaults to 0 -- conduct described, no leverage
claimed -- and only `level: 1` with a canonical `source_ref` builds the
leverage row that grants the one-level difficulty reduction
(`leverage_one_level = True if leverage else None`). The rule card projects
that slot to the Keeper as `{name, owner, type: "object"}`, and its `type` is
guessed from the slot name, so the contract never reaches the Keeper at all.

Seen live on 2026-09-02, on the forked worldline of amaranthine-run3: three
consecutive Extreme rescue checks with the player holding an earned clue --
the crypt slab with East Anglian arms and three crowns -- and every
adjudication reading `leverage: []`, `leverage_delta: 0`, while the opposition
counted at full weight from an NPC agenda the receipt itself marks
`player_known: false`. The Keeper had sent a reasonable-looking object
(`kind`, `clue_id`, `physical_prop`, `changed_method`) that means level 0.

Nothing about the arithmetic was wrong. The Keeper was never told what the
slot wanted, and a leverage level the Keeper cannot express is one the player
cannot earn.

The hint changes no rule: level 0 stays the default, and a Keeper that writes
`level: 0` outright is not second-guessed.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


adapter = _load(
    "coc7_rule_graph_adapter_support_hint_tests",
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule_graph_adapter.py",
)
hints_for = adapter.Coc7RuleGraphAdapter._support_level_hints


def test_a_shapeless_support_claim_is_told_it_counted_for_nothing() -> None:
    """The exact live payload: sensible keys, no `level`, zero leverage."""
    hints = hints_for(
        {
            "supporting_action": {
                "kind": "player_known_clue_challenge",
                "clue_id": "clue-crown-slab-heraldry",
                "physical_prop": "rusted silver charm",
                "audience": "priests",
                "changed_method": True,
            },
        },
        {"leverage": [], "leverage_delta": 0, "final_difficulty": "extreme"},
    )
    assert len(hints) == 1
    hint = hints[0]
    # The hint must name both halves of the contract, or it repeats the same
    # failure in a different voice.
    assert "level" in hint and "source_ref" in hint


def test_an_explicit_level_zero_is_a_decision_and_is_left_alone() -> None:
    assert hints_for(
        {"supporting_action": {"level": 0, "description": "steady conduct"}},
        {"leverage": [], "leverage_delta": 0},
    ) == []


def test_a_granted_level_is_not_second_guessed() -> None:
    assert hints_for(
        {"supporting_action": {"level": 1, "source_ref": "clue:crown-slab"}},
        {"leverage": [{"leverage_id": "support:clue:crown-slab"}], "leverage_delta": 1},
    ) == []


def test_no_support_claim_says_nothing() -> None:
    assert hints_for({}, {"leverage": [], "leverage_delta": 0}) == []
    assert hints_for({"supporting_action": {}}, {"leverage_delta": 0}) == []
    assert hints_for({"supporting_action": None}, {"leverage_delta": 0}) == []
