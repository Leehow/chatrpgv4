"""Every decision the Keeper can settle must reach a real adapter.

The settle executor looks an adapter up by the capability node's
`resolver_capability`. The chase capability declares `chase.execute`; the map
registered `chase_start`, `chase_move`, `chase_hazard`, `chase_barrier`,
`chase_conflict`, `chase_end` — the compiler's command kinds, which match
nothing there. So all six chase decisions reached the executor and were
refused with `unsupported_ruleset_operation`, the whole family unsettleable,
and the refusal came AFTER candidate validation had already passed: the last
live turn composed a fully valid chase start and still could not settle it.
combat.context had the same shape.

A key that is merely spelled differently is invisible until a decision is
actually settled in play, which for chase had never happened. This test walks
the graph instead.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json"
RULES_CORE = ROOT / "plugins/coc-keeper/scripts/coc_operation_rules_core.py"
sys.path.insert(0, str(ROOT / "plugins" / "coc-keeper" / "scripts"))


def _graph() -> dict:
    return json.loads(GRAPH.read_text(encoding="utf-8"))


def _adapter_keys() -> set[str]:
    source = RULES_CORE.read_text(encoding="utf-8")
    start = source.index("adapters={")
    end = source.index("        },\n    )", start)
    return set(re.findall(r'"([a-z_.]+)":', source[start:end]))


def _capability_by_node(graph: dict) -> dict[str, str]:
    return {
        node["node_id"]: (node.get("properties") or {}).get("resolver_capability")
        for node in graph["nodes"]
        if node["node_kind"] == "capability"
    }


def _settleable_capabilities(graph: dict) -> dict[str, list[str]]:
    """resolver_capability -> the decisions that reach it."""
    capabilities = _capability_by_node(graph)
    reached: dict[str, list[str]] = {}
    for relation in graph["relations"]:
        if relation["relation_kind"] not in {"invokes", "implemented-by"}:
            continue
        capability = capabilities.get(relation["to_node_id"])
        if capability is None:
            continue
        source = next(
            (
                node for node in graph["nodes"]
                if node["node_id"] == relation["from_node_id"]
            ),
            None,
        )
        if source is None or source["node_kind"] != "decision":
            continue
        reached.setdefault(capability, []).append(source["node_id"])
    return reached


def test_every_settleable_capability_has_an_adapter():
    graph = _graph()
    reached = _settleable_capabilities(graph)
    keys = _adapter_keys()
    missing = {
        capability: sorted(decisions)
        for capability, decisions in reached.items()
        if capability not in keys
    }
    assert missing == {}, missing


def test_the_chase_family_reaches_its_executor():
    """The regression that hid until a chase was actually attempted."""
    graph = _graph()
    reached = _settleable_capabilities(graph)
    assert "chase.execute" in reached
    assert len(reached["chase.execute"]) == 6, reached["chase.execute"]
    assert "chase.execute" in _adapter_keys()


def test_the_map_is_keyed_by_capability_not_by_command_kind():
    """chase_start and friends are the compiler's command kinds. Registering
    them here looked like coverage and matched nothing."""
    keys = _adapter_keys()
    for command_kind in (
        "chase_start", "chase_move", "chase_hazard",
        "chase_barrier", "chase_conflict", "chase_end",
    ):
        assert command_kind not in keys, command_kind
