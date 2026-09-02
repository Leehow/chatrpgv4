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


def _adapter():
    return _load(
        "coc7_adapter_rule_card_slot_tests",
        ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule_graph_adapter.py",
    ).Coc7RuleGraphAdapter


def test_the_support_contract_is_stated_where_the_keeper_can_read_it() -> None:
    """`level: 1` plus `source_ref` is the whole point of the slot.

    The authored sentence alone does not carry it: "one substantive argument,
    bribe, threat, or other source-grounded support" does not tell a Keeper to
    write `level: 1`. The shape must.
    """
    shape = _adapter().semantic_input_shape("supporting_action")
    assert isinstance(shape, dict), "the object slot must carry a shape"
    props = shape.get("properties") or {}
    assert props.get("level", {}).get("enum") == [0, 1]
    assert "source_ref" in props
    stated = json.dumps(shape, ensure_ascii=False)
    assert "level 1" in stated and "source_ref" in stated, (
        "the shape must say that level 1 requires a source_ref, which is the "
        "only path to the one-level reduction"
    )


def test_a_slot_whose_type_word_says_everything_carries_no_shape() -> None:
    """Carried only where it adds something: a plain string needs no schema."""
    adapter = _adapter()
    assert adapter.semantic_input_shape("goal") is None
    assert adapter.semantic_input_shape("no_such_slot") is None
    # An enum's members ARE the contract, so it does carry one.
    assert (adapter.semantic_input_shape("difficulty") or {}).get("enum") == [
        "regular", "hard", "extreme",
    ]


def test_the_card_carries_the_shape_through_the_runtime() -> None:
    rt = runtime.RulesRuntime(
        GRAPH, ruleset_id="coc7", ruleset_adapter=_adapter(),
    )
    card = rt._card("decision:coc7:social:adjudicate-difficulty", {})
    rows = {row["name"]: row for row in card["required_inputs"]}
    assert "shape" in rows["supporting_action"]
    assert rows["supporting_action"]["shape"]["properties"]["level"]["enum"] == [0, 1]
    # The enum slot gains its actual members, which the type word never gave.
    assert rows["approach"]["shape"]["enum"] == [
        "charm", "fast_talk", "intimidate", "persuade",
    ]
    assert "shape" not in rows["goal"]


def test_a_runtime_without_an_adapter_simply_carries_no_shape() -> None:
    """The runtime stays ruleset-agnostic: it asks, and takes no answer."""
    rt = runtime.RulesRuntime(GRAPH, ruleset_id="coc7")
    card = rt._card("decision:coc7:social:adjudicate-difficulty", {})
    assert all("shape" not in row for row in card["required_inputs"])


def test_the_shape_survives_the_wire_and_stays_bounded() -> None:
    shape = _adapter().semantic_input_shape("supporting_action")
    projected = _project(_card([
        {
            "name": "supporting_action",
            "owner": "keeper-semantic",
            "type": "object",
            "shape": shape,
        },
    ]))
    assert projected is not None
    assert projected["required_inputs"][0]["shape"] == shape


@pytest.mark.parametrize(
    "shape",
    [
        {},
        "not-an-object",
        {"blob": "x" * (wire.RULE_DECISION_INPUT_SHAPE_MAX_BYTES + 1)},
    ],
)
def test_a_bad_shape_still_fails_closed(shape) -> None:
    assert wire._closed_rule_required_inputs([
        {"name": "a", "owner": "keeper-semantic", "type": "object", "shape": shape},
    ]) is None


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
