"""Every node kind a `continues-as` relation names must be readable downstream.

A rule decision card carries `possible_continuations`, the targets of the
decision's `continues-as` relations. The rule graph authors two node kinds
there — ordinary decisions and dedicated `continuation` nodes — but both
consumers accepted only the `decision:` namespace, and each fails destructively
rather than partially:

* `coc_mcp_wire._closed_rule_decision_ref_list` returns ``None`` when ANY ref
  is unaccepted, and its caller then returns ``None`` for the whole card, so
  the card silently disappears from the Keeper's rules context.
* Pi's identity projection reports the field in `diagnostics.unmapped`, and the
  extension replaces the entire `ok:true` envelope with
  `semantic_identity_unavailable`.

On a live table (2026-09-01, campaign amaranthine-run3) that was
`decision:coc7:social:adjudicate-difficulty`, which continues as
`continuation:coc7:push-luck:after-fail-push`: the Keeper asked for the social
rules in the middle of a conversation scene and was told the tool had failed.

These tests read the authored graph and both consumers' own declarations, so a
new continuation target kind fails here instead of deleting a rule card in play.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
RULESET = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
GRAPH = RULESET / "rule-graph.json"
WIRE = ROOT / "plugins" / "coc-keeper" / "scripts" / "coc_mcp_wire.py"
PI_PROJECTION = (
    ROOT / "plugins" / "coc-keeper" / "pi" / "lib" / "tool-contract-projection.ts"
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wire = _load("coc_mcp_wire_continuation_tests", WIRE)


def _graph() -> dict:
    return json.loads(GRAPH.read_text(encoding="utf-8"))


def _continuation_target_namespaces() -> set[str]:
    """The namespaces the authored graph actually points `continues-as` at."""
    graph = _graph()
    nodes = {
        str(node.get("node_id")): node for node in graph.get("nodes") or []
    }
    relations = graph.get("relations") or graph.get("edges") or []
    namespaces = set()
    for relation in relations:
        kind = relation.get("relation_kind") or relation.get("kind")
        if kind != "continues-as":
            continue
        target = str(relation.get("to_node_id"))
        assert target in nodes, f"continues-as points at a missing node: {target}"
        namespaces.add(target.split(":", 1)[0] + ":")
    return namespaces


def _pi_namespaces() -> tuple[str, ...]:
    """Read Pi's accepted set out of its source rather than restating it."""
    text = PI_PROJECTION.read_text(encoding="utf-8")
    match = re.search(
        r"const RULE_CONTINUATION_REF_NAMESPACE = stringSet\(\[(?P<items>[^\]]*)\]\)",
        text,
    )
    assert match, "Pi's continuation namespace set not found; update this test"
    return tuple(re.findall(r'"([^"]+)"', match.group("items")))


def test_the_graph_authors_more_than_one_continuation_namespace():
    # If this ever collapses to one namespace the whole class is moot, and the
    # test below would pass vacuously.
    assert len(_continuation_target_namespaces()) >= 2


def test_the_wire_accepts_every_authored_continuation_namespace():
    missing = _continuation_target_namespaces() - set(
        wire.RULE_CONTINUATION_REF_PREFIXES
    )
    assert not missing, (
        f"the wire drops any card whose continuation uses {sorted(missing)}, "
        "and it drops the whole card, not the field"
    )


def test_pi_accepts_every_authored_continuation_namespace():
    missing = _continuation_target_namespaces() - set(_pi_namespaces())
    assert not missing, (
        f"Pi fails the whole rules.context result closed on {sorted(missing)}"
    )


def test_both_consumers_agree_on_one_set():
    assert set(wire.RULE_CONTINUATION_REF_PREFIXES) == set(_pi_namespaces())


@pytest.mark.parametrize(
    "refs,accepted",
    [
        (["decision:coc7:social:adjudicate-difficulty"], True),
        (["continuation:coc7:push-luck:after-fail-push"], True),
        (
            [
                "decision:coc7:social:adjudicate-difficulty",
                "continuation:coc7:push-luck:after-fail-push",
            ],
            True,
        ),
        # Still closed against everything else: an unnamespaced id, another
        # kind's namespace, and a duplicate.
        (["adjudicate-difficulty"], False),
        (["rule:coc7:social:opposed"], False),
        (["decision:a", "decision:a"], False),
    ],
)
def test_the_wire_list_is_closed_but_not_narrow(refs, accepted):
    result = wire._closed_rule_decision_ref_list(
        refs, prefix=wire.RULE_CONTINUATION_REF_PREFIXES,
    )
    assert (result is not None) is accepted


def test_one_unaccepted_ref_still_destroys_the_whole_list():
    """The failure mode that makes coverage above load-bearing, not cosmetic."""
    assert wire._closed_rule_decision_ref_list(
        [
            "decision:coc7:social:adjudicate-difficulty",
            "not-a-namespaced-ref",
        ],
        prefix=wire.RULE_CONTINUATION_REF_PREFIXES,
    ) is None
