"""A rule card must survive its own slot types, and say what a slot wants.

Two defects of one shape, both found from live play on 2026-09-02.

1. `RULE_DECISION_INPUT_TYPES` listed eight slot types; the authored coc7 graph
   declares eleven, and five of the missing ones are model-facing (`enum`,
   `object`, `array`, `semantic`, `semantic-ref-array` -- 20 slots). The
   projector is exact-match and returns `None` for the WHOLE block on one
   unmatched row, so any card carrying an enum or object slot vanished from
   scene.context entirely. `social:adjudicate-difficulty` is exactly such a
   card: `approach` is an enum, `supporting_action` is an object. That is the
   same failure already recorded in this file for `possible_continuations` --
   one unmatched member drops the card rather than degrading it.

2. The card projected `{name, owner, type}` and dropped the input-slot node's
   authored sentence saying what the slot wants. A slot typed `object` --
   whose `type` is itself guessed from the slot name -- therefore reached the
   Keeper with no contract at all. Live: the Keeper filled `supporting_action`
   with a reasonable-looking object, it adjudicated as level 0, and the
   player's earned clue granted no leverage across three Extreme rescue
   checks.

The description is carried, never required: a slot with no authored sentence
is still a valid row.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


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


_load("coc_toolbox_rule_card_slot_tests", SCRIPTS / "coc_toolbox.py")
wire = _load("coc_mcp_wire_rule_card_slot_tests", SCRIPTS / "coc_mcp_wire.py")
runtime = _load("coc_rules_runtime_rule_card_slot_tests", SCRIPTS / "coc_rules_runtime.py")

GRAPH = json.loads(
    (ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule-graph.json")
    .read_text(encoding="utf-8"),
)


def _card(required_inputs: list[dict]) -> dict:
    """The live social adjudication card, shaped exactly as the Keeper saw it."""
    return {
        "schema_version": 1,
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "family": "social",
        "label": "Adjudicate one possible social goal",
        "applicability": "applicable",
        "required_inputs": required_inputs,
        "locked_inputs": ["npc_defense", "motive_evidence"],
        "rule_ref_ids": [0],
        "source_ref_ids": [0],
        "capability_ref": "capability:coc7:social-difficulty",
        "effect_refs": [],
        "possible_continuations": [],
        "authority": {
            "selection": "keeper-semantic",
            "execution": "current-ruleset-adapter",
            "hard_gate": False,
        },
    }


def _project(card: dict):
    return wire._compact_rule_decision_card(
        card, family="social", rule_table_size=1, source_table_size=1,
    )


def test_every_model_facing_slot_type_the_graph_declares_is_registered() -> None:
    """The whitelist must cover the authored vocabulary, or cards vanish."""
    declared = {
        (node.get("properties") or {}).get("value_type")
        for node in GRAPH["nodes"]
        if node.get("node_kind") == "input-slot"
        and (node.get("properties") or {}).get("ownership")
        in runtime._SEMANTIC_SLOT_OWNERSHIPS
    }
    declared.discard(None)
    missing = sorted(declared - set(wire.RULE_DECISION_INPUT_TYPES))
    assert missing == [], (
        "these slot types are declared by the ruleset graph and unregistered "
        "here; the projector returns None for the whole block on one "
        f"unmatched row, so every card carrying one vanishes: {missing}"
    )


def test_the_social_card_survives_its_enum_and_object_slots() -> None:
    projected = _project(_card([
        {"name": "approach", "owner": "keeper-semantic", "type": "enum"},
        {"name": "supporting_action", "owner": "keeper-semantic", "type": "object"},
    ]))
    assert projected is not None, (
        "the core social adjudication card must reach the Keeper; dropping it "
        "leaves difficulty to be set by something other than the adjudicator "
        "that owns it"
    )


def test_an_authored_slot_description_reaches_the_keeper() -> None:
    sentence = (
        "One substantive argument, bribe, threat, or other source-grounded "
        "support for the case"
    )
    projected = _project(_card([
        {
            "name": "supporting_action",
            "owner": "keeper-semantic",
            "type": "object",
            "description": sentence,
        },
    ]))
    assert projected is not None
    assert projected["required_inputs"][0]["description"] == sentence


def test_a_slot_without_a_description_is_still_valid() -> None:
    """Carried, never required."""
    projected = _project(_card([
        {"name": "approach", "owner": "keeper-semantic", "type": "enum"},
    ]))
    assert projected is not None
    assert "description" not in projected["required_inputs"][0]


@pytest.mark.parametrize(
    "row",
    [
        {"name": "a", "owner": "keeper-semantic", "type": "string", "bogus": 1},
        {"name": "a", "owner": "keeper-semantic", "type": "string", "description": "  "},
        {"name": "a", "owner": "keeper-semantic", "type": "string", "description": 7},
        {"name": "a", "owner": "keeper-semantic", "type": "string",
         "description": "x" * (wire.RULE_DECISION_INPUT_DESCRIPTION_MAX + 1)},
        {"name": "a", "owner": "keeper-semantic", "type": "unregistered-type"},
        {"name": "a", "owner": "not-an-owner", "type": "string"},
    ],
)
def test_nothing_was_loosened(row: dict) -> None:
    """An unknown key, a bad description, an unknown type or owner still fails
    closed exactly as before."""
    assert wire._closed_rule_required_inputs([row]) is None


def test_the_runtime_carries_the_input_slot_sentence_onto_the_card() -> None:
    """The sentence is authored in the graph; the card must not drop it."""
    node = next(
        n for n in GRAPH["nodes"]
        if n.get("node_id") == "input-slot:coc7:social:supporting-action"
    )
    assert isinstance(node.get("name"), str) and node["name"].strip(), (
        "this test is meaningless if the graph stops authoring the sentence"
    )
    rt = runtime.RulesRuntime(GRAPH, ruleset_id="coc7")
    slots = {
        slot["name"]: slot
        for slot in rt._slots_for("decision:coc7:social:adjudicate-difficulty")
    }
    assert slots["supporting_action"].get("description") == node["name"]
