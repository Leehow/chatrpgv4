"""The graph's declared effects must be produced by something real.

An `effect` node in the CoC7 RuleGraph carries a name and a family id and
nothing else, and the settle path never reads it: the executor produces
whatever it produces. So the graph can declare an effect no code produces —
or an executor can stop producing one — with nothing failing. These tests are
the missing accounting. They compare three independent sources: the graph's
own `emits` relations, the adapter's closed producer index, and the canonical
toolbox's operation registry.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
GRAPH = PLUGIN / "rulesets" / "coc7" / "rule-graph.json"
SCRIPTS = PLUGIN / "scripts"


def _adapter():
    sys.path.insert(0, str(SCRIPTS))
    path = PLUGIN / "rulesets" / "coc7" / "rule_graph_adapter.py"
    spec = importlib.util.spec_from_file_location("coc7_rule_graph_adapter", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.Coc7RuleGraphAdapter


def _graph() -> dict:
    return json.loads(GRAPH.read_text(encoding="utf-8"))


def _emitted_effects(graph: dict) -> dict[str, list[str]]:
    """Emitting node id -> the effect kinds it declares."""
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    emitted: dict[str, list[str]] = {}
    for relation in graph["relations"]:
        if relation["relation_kind"] != "emits":
            continue
        target = nodes[relation["to_node_id"]]
        kind = (target.get("properties") or {}).get("effect_kind")
        assert isinstance(kind, str) and kind, target["node_id"]
        emitted.setdefault(relation["from_node_id"], []).append(kind)
    return emitted


def _reached_capabilities(graph: dict, node_id: str) -> list[dict]:
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    reached = []
    for relation in graph["relations"]:
        if relation["from_node_id"] != node_id:
            continue
        if relation["relation_kind"] not in {"invokes", "implemented-by"}:
            continue
        target = nodes[relation["to_node_id"]]
        if target["node_kind"] == "capability":
            reached.append(target)
    return reached


def test_every_declared_effect_kind_has_a_producer():
    """A graph edit that invents an effect nobody produces fails here."""
    graph = _graph()
    index = _adapter().effect_producer_index()
    declared = {
        kind for kinds in _emitted_effects(graph).values() for kind in kinds
    }
    assert declared - set(index) == set(), (
        "graph declares effect kinds with no producer in the adapter index"
    )
    assert set(index) - declared == set(), (
        "the adapter index names effect kinds the graph no longer declares"
    )


def test_capability_produced_effects_match_the_invoked_capability():
    """The producer named for an effect must be the capability its own
    decision invokes — not merely some operation that exists."""
    graph = _graph()
    index = _adapter().effect_producer_index()
    for node_id, kinds in _emitted_effects(graph).items():
        capability_kinds = [
            kind for kind in kinds if index[kind]["via"] == "capability"
        ]
        if not capability_kinds:
            continue
        resolvers = {
            (capability.get("properties") or {}).get("resolver_capability")
            for capability in _reached_capabilities(graph, node_id)
        }
        assert resolvers, f"{node_id} declares effects but invokes no capability"
        for kind in capability_kinds:
            assert index[kind]["producer"] in resolvers, (
                f"{node_id} declares {kind}, produced by "
                f"{index[kind]['producer']}, but invokes {sorted(resolvers)}"
            )


def test_host_state_effects_name_a_real_operation_and_no_capability():
    """The escape hatch is narrow: an effect is host-state produced only when
    its own node invokes no capability at all, and the operation it names must
    exist in the canonical toolbox."""
    sys.path.insert(0, str(SCRIPTS))
    import coc_toolbox  # noqa: PLC0415

    graph = _graph()
    index = _adapter().effect_producer_index()
    emitted = _emitted_effects(graph)
    for kind, entry in index.items():
        if entry["via"] != "host_state":
            continue
        assert entry["producer"] in coc_toolbox.TOOLS, entry["producer"]
        owners = [
            node_id for node_id, kinds in emitted.items() if kind in kinds
        ]
        for node_id in owners:
            assert not _reached_capabilities(graph, node_id), (
                f"{node_id} reaches a capability, so {kind} is not host-state "
                "produced"
            )


def test_capability_producers_are_operations_the_runtime_dispatches():
    """Every capability-produced effect names a resolver capability the
    adapter can actually dispatch: a typed host operation, or a resolver
    capability a graph capability node binds."""
    graph = _graph()
    adapter = _adapter()
    index = adapter.effect_producer_index()
    host_operations = set(adapter.host_capability_index())
    bound_resolvers = {
        (node.get("properties") or {}).get("resolver_capability")
        for node in graph["nodes"]
        if node["node_kind"] == "capability"
    }
    for kind, entry in index.items():
        if entry["via"] != "capability":
            continue
        producer = entry["producer"]
        assert producer in host_operations or producer in bound_resolvers, (
            f"{kind} names producer {producer}, which is neither a typed host "
            "operation nor a resolver capability the graph binds"
        )


# ---------------------------------------------------------------------------
# Data tables: the graph names a file and stops there.
# ---------------------------------------------------------------------------

TABLES = PLUGIN / "rulesets" / "coc7" / "rules-json"
DIGESTS = PLUGIN / "rulesets" / "coc7" / "rule-graph-table-digests.json"


def _digest_manifest() -> dict:
    return json.loads(DIGESTS.read_text(encoding="utf-8"))


def _named_tables(graph: dict) -> dict[str, list[str]]:
    named: dict[str, list[str]] = {}
    for node in graph["nodes"]:
        if node["node_kind"] != "data-table":
            continue
        name = (node.get("properties") or {}).get("table_name")
        assert isinstance(name, str) and name, node["node_id"]
        named.setdefault(name, []).append(node["node_id"])
    return {name: sorted(ids) for name, ids in named.items()}


def test_bound_table_bytes_match_the_manifest():
    """A data-table node names a file, so the numbers a rule reads carry no
    evidence of their own. Changing them without regenerating the graph fails
    here instead of passing silently."""
    import hashlib  # noqa: PLC0415

    manifest = _digest_manifest()
    for row in manifest["bound_tables"]:
        path = TABLES / row["table_name"]
        assert path.is_file(), row["table_name"]
        digest = f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
        assert digest == row["sha256"], (
            f"{row['table_name']} changed without updating the manifest; the "
            f"graph nodes {row['node_ids']} still claim the old bytes"
        )


def test_the_manifest_and_the_graph_name_the_same_tables():
    graph = _graph()
    manifest = _digest_manifest()
    named = _named_tables(graph)
    recorded = {row["table_name"]: row["node_ids"] for row in manifest["bound_tables"]}
    assert recorded == named, (
        "the manifest and the graph disagree about which tables are bound"
    )


def test_the_unbound_table_gap_cannot_grow_silently():
    """31 rules-json tables carry numbers no graph node binds — the damage
    bonus/build table, the chase hazards, the SAN bout tables. That gap is
    recorded, not enforced away; a NEW unbound table fails until it is either
    bound in the graph or added here deliberately."""
    graph = _graph()
    manifest = _digest_manifest()
    present = {path.name for path in TABLES.glob("*.json")}
    unbound = sorted(present - set(_named_tables(graph)))
    assert unbound == manifest["unbound_tables"], (
        "the set of tables the graph does not bind changed; bind the new "
        "table in the graph, or record it in rule-graph-table-digests.json "
        "with the reason"
    )
